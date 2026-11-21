const { createApp, ref, computed, onMounted, watch, nextTick } = Vue;

const app = createApp({
    setup() {
        // App Configuration
        const config = window.APP_CONFIG || {
            GOOGLE_SCRIPT_URL: '',
            GOOGLE_CLIENT_ID: '',
            AUTO_REFRESH_MINUTES: 60,
            CUTOFF_START_DAY: 20,
            CUTOFF_END_DAY: 19,
            WEEKLY_TARGET_HOURS: 48.0,
            AUTO_WO_DAYS: [4, 6] // Thursday (4) and Saturday (6)
        };

        // Navigation State: 'daily' | 'summary' | 'schedule' | 'roster' | 'admin'
        const currentTab = ref('daily');
        const loading = ref(false);
        const initialLoading = ref(false);
        const toastMessage = ref('');
        const toastType = ref('success');

        // Google Sheet Connection State
        const googleSheetWebAppUrl = ref(config.GOOGLE_SCRIPT_URL || '');
        const sheetConnectionStatus = ref('unconnected');
        const sheetLastSyncTime = ref('');

        // Master Dynamic Data (LOADED ONLY FROM GOOGLE SHEET)
        const staffList = ref([]);
        const locations = ref([]);
        const attendanceLogs = ref([]);
        const usersList = ref([]);
        const allocationsList = ref([]);
        const schedulesList = ref([]);
        const rolesList = ref([]);

        // Authentication State (Google Sign-In) & Role Permissions
        const currentUser = ref(null);
        const isAuthChecking = ref(false);
        const authError = ref('');

        // Computed Role & Permission Helpers
        const userRole = computed(() => currentUser.value ? (currentUser.value.role || 'Data_Entry') : '');
        const isAdmin = computed(() => userRole.value === 'Admin');
        const canDataEntry = computed(() => userRole.value === 'Admin' || userRole.value === 'Data_Entry');
        const canExportReports = computed(() => userRole.value === 'Admin' || userRole.value === 'Report_Only');

        // Staff Visibility based on User_Allocation sheet
        // Admin & Report_Only see ALL staff; Data_Entry users only see their allocated staff
        const visibleStaffList = computed(() => {
            if (staffList.value.length === 0) return [];
            if (isAdmin.value || userRole.value === 'Report_Only') {
                return staffList.value;
            }

            if (!currentUser.value) return [];
            const myEmpCode = currentUser.value.staff ? (currentUser.value.staff.employee_code || '').toString().trim() : '';
            const myName = (currentUser.value.userName || currentUser.value.name || '').toLowerCase().trim();

            // Find allocation rows where current user is the assigned controller
            const myAllocRows = allocationsList.value.filter(al => {
                const targetCode = (al.allocated_to_code || '').toString().trim();
                const targetName = (al.allocated_to_name || '').toLowerCase().trim();
                return (myEmpCode && targetCode === myEmpCode) ||
                       (targetName && (targetName === myName || myName.includes(targetName) || targetName.includes(myName)));
            });

            if (myAllocRows.length > 0) {
                const allowedCodes = new Set(myAllocRows.map(a => (a.employee_code || '').toString().trim()));
                const allowedNames = new Set(myAllocRows.map(a => (a.employee_name || '').toLowerCase().trim()));

                const filtered = staffList.value.filter(s =>
                    allowedCodes.has((s.employee_code || '').toString().trim()) ||
                    allowedNames.has((s.name || '').toLowerCase().trim())
                );
                return filtered.length > 0 ? filtered : staffList.value;
            }

            // Fallback: If no allocation row, show user's own profile or all
            if (currentUser.value.staff) {
                return [currentUser.value.staff];
            }
            return staffList.value;
        });

        // Date Helpers (Timezone safe for UAE GMT+4)
        const getTodayLocalStr = () => {
            const d = new Date();
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        const formatDateLocal = (d) => {
            if (!d) return '';
            const dateObj = (d instanceof Date) ? d : new Date(d);
            if (isNaN(dateObj.getTime())) return String(d);
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const day = String(dateObj.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };

        const getAuditTimestamp = () => {
            const d = new Date();
            const day = String(d.getDate()).padStart(2, '0');
            const mon = String(d.getMonth() + 1).padStart(2, '0');
            const yr = String(d.getFullYear()).slice(-2);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            return `${day}:${mon}:${yr} ${hh}:${mm}:${ss}`;
        };

        const todayStr = getTodayLocalStr();

        // Cutoff & Filter State
        const selectedYear = ref(new Date().getFullYear());
        const selectedMonth = ref(new Date().getMonth() + 1);
        const selectedCycle = ref('');
        const selectedLoc = ref('ALL');
        const searchQuery = ref('');
        const statusFilter = ref('ALL');

        // Smart Attendance Entry Form State
        const entryForm = ref({
            staff_id: null,
            staff_name: '',
            employee_code: '',
            date: todayStr,
            status: 'Present',
            check_in: '07:00',
            check_out: '17:00',
            break_minutes: 0,
            total_hours: 10.0,
            location: '',
            notes: ''
        });

        // Smart Search Autocomplete States
        const staffSearchQuery = ref('');
        const showStaffDropdown = ref(false);
        const locationSearchQuery = ref('');

        // Toast Helper
        const showToast = (msg, type = 'success') => {
            toastMessage.value = msg;
            toastType.value = type;
            setTimeout(() => {
                toastMessage.value = '';
            }, 3500);
        };

        // Filtered staff for autocomplete search (respects user's allocation!)
        const matchedStaffList = computed(() => {
            const baseList = visibleStaffList.value;
            if (!staffSearchQuery.value) return baseList.slice(0, 10);
            const q = staffSearchQuery.value.toLowerCase().trim();
            return baseList.filter(s =>
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.employee_code && s.employee_code.toLowerCase().includes(q)) ||
                (s.designation && s.designation.toLowerCase().includes(q))
            ).slice(0, 12);
        });

        // Alphabetically sorted locations list from Locations sheet
        const sortedLocations = computed(() => {
            return [...locations.value].sort((a, b) => (a.branch || '').localeCompare(b.branch || ''));
        });

        // Filtered locations for smart branch selector
        const matchedLocations = computed(() => {
            if (!locationSearchQuery.value) return sortedLocations.value;
            const q = locationSearchQuery.value.toLowerCase().trim();
            return sortedLocations.value.filter(loc =>
                (loc.branch && loc.branch.toLowerCase().includes(q)) ||
                (loc.emr && loc.emr.toLowerCase().includes(q)) ||
                (loc.location && loc.location.toLowerCase().includes(q))
            );
        });

        // Autocomplete selections
        const selectStaffForEntry = (s) => {
            entryForm.value.staff_id = s.id || s.employee_code;
            entryForm.value.staff_name = s.name;
            entryForm.value.employee_code = s.employee_code;
            staffSearchQuery.value = `${s.name} (${s.employee_code})`;
            showStaffDropdown.value = false;

            if (s.allocated_to) {
                const exactMatch = locations.value.find(l => (l.branch || '').toLowerCase() === s.allocated_to.toLowerCase());
                if (exactMatch) {
                    entryForm.value.location = exactMatch.branch;
                } else if (!entryForm.value.location && locations.value.length > 0) {
                    entryForm.value.location = locations.value[0].branch;
                }
            } else if (!entryForm.value.location && locations.value.length > 0) {
                entryForm.value.location = locations.value[0].branch;
            }
        };

        // Live calculation of hours
        const updateEntryHours = () => {
            if (entryForm.value.status === 'WO' || entryForm.value.status === 'OFF' || entryForm.value.status === 'Unpaid Leave') {
                entryForm.value.total_hours = 0.0;
                return;
            }
            if (entryForm.value.status === 'Paid Leave') {
                entryForm.value.total_hours = 8.0;
                return;
            }
            try {
                const inParts = entryForm.value.check_in.split(':').map(Number);
                const outParts = entryForm.value.check_out.split(':').map(Number);
                let inMin = inParts[0] * 60 + inParts[1];
                let outMin = outParts[0] * 60 + outParts[1];
                if (outMin < inMin) outMin += 24 * 60; // Overnight shift
                const diff = (outMin - inMin - (entryForm.value.break_minutes || 0)) / 60.0;
                entryForm.value.total_hours = parseFloat(Math.max(0, diff).toFixed(2));
            } catch (e) {
                // ignore
            }
        };

        // Selected Date Day Info
        const entryDateDayInfo = computed(() => {
            if (!entryForm.value.date) return { name: '', isWeekend: false };
            const parts = entryForm.value.date.split('-').map(Number);
            const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
            const dayNum = d.getDay();
            const name = d.toLocaleDateString('en-US', { weekday: 'long' });
            return {
                name,
                isWeekend: dayNum === 4 || dayNum === 6
            };
        });

        watch(() => entryForm.value.status, () => updateEntryHours());

        // Quick Log a missing date
        const quickLogDate = (dateStr) => {
            if (!canDataEntry.value) {
                showToast("Access Denied: Data entry is restricted for your role (" + userRole.value + ").", "error");
                return;
            }
            if (dateStr > todayStr) {
                showToast("Future dates cannot be logged.", "error");
                return;
            }
            entryForm.value.date = dateStr;
            updateEntryHours();
            const el = document.getElementById('entry-form-section');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            showToast(`Selected date: ${dateStr}. Review details and click ADD.`);
        };

        // -------------------------------------------------------------
        // LIVE GOOGLE SHEET DATA SYNC
        // -------------------------------------------------------------
        const syncGoogleSheet = async (isBackground = false) => {
            const url = googleSheetWebAppUrl.value.trim();
            if (!url) return;

            if (!isBackground) loading.value = true;
            sheetConnectionStatus.value = 'connecting';

            try {
                const res = await fetch(`${url}?action=get_all`);
                const data = await res.json();

                if (data.status === 'success') {
                    if (data.staff && Array.isArray(data.staff)) {
                        staffList.value = data.staff;
                    }
                    if (data.locations && Array.isArray(data.locations)) {
                        locations.value = data.locations;
                        if (!entryForm.value.location && data.locations.length > 0) {
                            entryForm.value.location = data.locations[0].branch;
                        }
                    }
                    if (data.attendance && Array.isArray(data.attendance)) {
                        attendanceLogs.value = data.attendance;
                    }
                    if (data.users && Array.isArray(data.users)) {
                        usersList.value = data.users;
                        if (currentUser.value && currentUser.value.email) {
                            const uMatch = usersList.value.find(u => u.gmail && u.gmail.toLowerCase().trim() === currentUser.value.email.toLowerCase().trim());
                            if (uMatch && uMatch.role) {
                                currentUser.value.role = uMatch.role;
                                localStorage.setItem('attendance_auth_user', JSON.stringify(currentUser.value));
                            }
                        }
                    }
                    if (data.allocations && Array.isArray(data.allocations)) {
                        allocationsList.value = data.allocations;
                    }
                    if (data.schedules && Array.isArray(data.schedules)) {
                        schedulesList.value = data.schedules;
                    }
                    if (data.roles && Array.isArray(data.roles)) {
                        rolesList.value = data.roles;
                    }

                    // Auto-select staff record if available
                    if (canDataEntry.value && !entryForm.value.staff_name && currentUser.value && currentUser.value.staff) {
                        selectStaffForEntry(currentUser.value.staff);
                    } else if (canDataEntry.value && !entryForm.value.staff_name && visibleStaffList.value.length > 0) {
                        selectStaffForEntry(visibleStaffList.value[0]);
                    }

                    sheetConnectionStatus.value = 'connected';
                    const now = new Date().toLocaleTimeString();
                    sheetLastSyncTime.value = now;

                    if (!isBackground) {
                        showToast(`Connected! Loaded ${staffList.value.length} Staff, ${locations.value.length} Locations & ${schedulesList.value.length} Schedules.`);
                    }
                } else {
                    sheetConnectionStatus.value = 'error';
                    if (!isBackground) showToast("Google Sheet returned unexpected format", "error");
                }
            } catch (err) {
                console.error("Google Sheet Sync Error:", err);
                sheetConnectionStatus.value = 'error';
                if (!isBackground) showToast("Could not connect to Google Sheet Web App", "error");
            } finally {
                if (!isBackground) loading.value = false;
            }
        };

        // -------------------------------------------------------------
        // SUBMIT ATTENDANCE (ADD BUTTON)
        // -------------------------------------------------------------
        const submitAttendanceEntry = async (allowUpdate = false) => {
            if (!canDataEntry.value) {
                showToast("Access Denied: Your role (" + userRole.value + ") cannot submit attendance.", "error");
                return;
            }
            if (!entryForm.value.staff_id) {
                showToast("Please search and select an employee first", "error");
                return;
            }
            if (!entryForm.value.date) {
                showToast("Please select a date", "error");
                return;
            }
            if (entryForm.value.date > todayStr) {
                showToast("Future dates are not allowed. Please select today or a past date.", "error");
                return;
            }

            loading.value = true;
            const updatedBy = currentUser.value ? (currentUser.value.name || currentUser.value.email) : 'User';
            const payload = {
                action: 'log_attendance',
                staff_id: entryForm.value.staff_id,
                employee_code: entryForm.value.employee_code,
                name: entryForm.value.staff_name,
                date: entryForm.value.date,
                status: entryForm.value.status,
                check_in: entryForm.value.status === 'Present' ? entryForm.value.check_in : '',
                check_out: entryForm.value.status === 'Present' ? entryForm.value.check_out : '',
                break_minutes: entryForm.value.break_minutes || 0,
                total_hours: entryForm.value.total_hours,
                location: entryForm.value.location,
                notes: entryForm.value.notes || '',
                allow_update: allowUpdate,
                updated_by_user: updatedBy
            };

            try {
                if (!googleSheetWebAppUrl.value) {
                    showToast("Google Sheet backend not configured!", "error");
                    loading.value = false;
                    return;
                }

                let data = null;
                try {
                    const encoded = encodeURIComponent(JSON.stringify(payload));
                    const res = await fetch(`${googleSheetWebAppUrl.value}?action=log_attendance&payload=${encoded}`);
                    data = await res.json();
                } catch (getErr) {
                    console.warn("GET submission failed, trying POST:", getErr);
                    const postRes = await fetch(googleSheetWebAppUrl.value, {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    data = await postRes.json();
                }

                if (data && data.status === 'duplicate') {
                    if (confirm(`Duplicate Entry: Attendance is already logged for ${entryForm.value.staff_name} on ${entryForm.value.date}.\n\nDo you want to update this existing record?`)) {
                        await submitAttendanceEntry(true);
                    }
                    loading.value = false;
                    return;
                }

                if (data && data.status === 'error') {
                    showToast("Error from Google Sheet: " + data.message, "error");
                    loading.value = false;
                    return;
                }

                // Update local logs in memory
                const existingIdx = attendanceLogs.value.findIndex(l =>
                    (l.employee_code === payload.employee_code || l.name === payload.name) && l.date === payload.date
                );

                if (existingIdx >= 0) {
                    attendanceLogs.value[existingIdx] = payload;
                } else {
                    attendanceLogs.value.unshift(payload);
                }

                showToast(`Saved! ${payload.name}: ${payload.status} (${payload.total_hours}h) on ${payload.date}`);
                entryForm.value.notes = '';

            } catch (err) {
                console.error("Submit Attendance Error:", err);
                showToast("Error saving to Google Sheet: " + (err.message || err), "error");
            } finally {
                loading.value = false;
            }
        };

        // -------------------------------------------------------------
        // CALENDAR WEEKS: MONDAY TO SUNDAY PARTITIONING
        // -------------------------------------------------------------
        const getCutoffDates = (year, month) => {
            const start = new Date(year, month - 1, 20, 12, 0, 0);
            const end = (month === 12)
                ? new Date(year + 1, 0, 19, 12, 0, 0)
                : new Date(year, month, 19, 12, 0, 0);
            return { start, end };
        };

        const partitionMondayToSundayWeeks = (start, end) => {
            const weeks = [];
            let curr = new Date(start);
            let wNum = 1;

            while (curr <= end) {
                const dayOfWeek = curr.getDay();
                const daysToSunday = (dayOfWeek === 0) ? 0 : (7 - dayOfWeek);

                let wEnd = new Date(curr);
                wEnd.setDate(wEnd.getDate() + daysToSunday);
                if (wEnd > end) {
                    wEnd = new Date(end);
                }

                const daysCount = Math.round((wEnd - curr) / (1000 * 60 * 60 * 24)) + 1;

                let workdays = 0;
                let temp = new Date(curr);
                while (temp <= wEnd) {
                    const d = temp.getDay();
                    if (d !== 4 && d !== 6) {
                        workdays++;
                    }
                    temp.setDate(temp.getDate() + 1);
                }

                const targetHours = (daysCount === 7 && workdays === 5)
                    ? 48.0
                    : Math.round(workdays * 9.6 * 10) / 10;

                weeks.push({
                    week_number: wNum,
                    start_date: formatDateLocal(curr),
                    end_date: formatDateLocal(wEnd),
                    days_count: daysCount,
                    working_days: workdays,
                    target_hours: targetHours,
                    label: `Week ${wNum} (${curr.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${wEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
                });

                curr = new Date(wEnd);
                curr.setDate(curr.getDate() + 1);
                wNum++;
            }

            return weeks;
        };

        // Available Cutoff Cycles
        const availableCycles = computed(() => {
            const list = [];
            const currYear = new Date().getFullYear();
            for (let m = 1; m <= 12; m++) {
                const { start, end } = getCutoffDates(currYear, m);
                list.push({
                    year: currYear,
                    month: m,
                    key: `${currYear}-${m}`,
                    label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                });
            }
            return list;
        });

        // Compute Full Attendance Report & Weekly Breakdowns (based on visibleStaffList)
        const reportData = computed(() => {
            const activeStaff = visibleStaffList.value;
            if (activeStaff.length === 0) {
                return {
                    cycle_label: 'No Staff Data',
                    weeks: [],
                    stats: { total_staff: 0, aggregate_hours: 0, aggregate_overtime: 0, aggregate_undertime: 0, net_aggregate_balance: 0, ot_count: 0, ut_count: 0 },
                    staff_reports: []
                };
            }

            const { start, end } = getCutoffDates(selectedYear.value, selectedMonth.value);
            const weeks = partitionMondayToSundayWeeks(start, end);

            const logsMap = {};
            attendanceLogs.value.forEach(log => {
                if (log.employee_code && log.date) {
                    logsMap[`${log.employee_code}_${log.date}`] = log;
                }
                if (log.name && log.date) {
                    logsMap[`${log.name}_${log.date}`] = log;
                }
            });

            let totalAggHours = 0;
            let totalAggOT = 0;
            let totalAggUT = 0;
            let otCount = 0;
            let utCount = 0;

            const staffReports = activeStaff.map(staff => {
                let staffMonthHours = 0;
                let staffMonthTarget = 0;
                let staffTotalOT = 0;
                let staffTotalUT = 0;
                let daysPresent = 0;
                let daysWO = 0;
                let missingCount = 0;

                const weeklyBreakdown = weeks.map(w => {
                    let wHours = 0;
                    const wDays = [];
                    const wStartParts = w.start_date.split('-').map(Number);
                    const wEndParts = w.end_date.split('-').map(Number);
                    let curr = new Date(wStartParts[0], wStartParts[1] - 1, wStartParts[2], 12, 0, 0);
                    const endD = new Date(wEndParts[0], wEndParts[1] - 1, wEndParts[2], 12, 0, 0);

                    while (curr <= endD) {
                        const dateStr = formatDateLocal(curr);
                        const dayOfWeek = curr.getDay();
                        const isWeekOffDay = (dayOfWeek === 4 || dayOfWeek === 6);
                        const log = logsMap[`${staff.employee_code}_${dateStr}`] || logsMap[`${staff.name}_${dateStr}`];

                        let status = "Missing";
                        let hours = 0.0;
                        let isAutoWO = false;
                        let checkIn = "";
                        let checkOut = "";
                        let location = staff.allocated_to;
                        let notes = "";

                        if (log) {
                            status = log.status || "Present";
                            hours = parseFloat(log.total_hours) || 0.0;
                            checkIn = log.check_in || "";
                            checkOut = log.check_out || "";
                            location = log.location || staff.allocated_to;
                            notes = log.notes || "";
                        } else {
                            if (isWeekOffDay) {
                                status = "WO";
                                hours = 0.0;
                                isAutoWO = true;
                            } else {
                                status = "Missing";
                                hours = 0.0;
                                missingCount++;
                            }
                        }

                        if (status === 'Present') daysPresent++;
                        else if (status === 'WO') daysWO++;

                        wHours += hours;
                        wDays.push({
                            date: dateStr,
                            day_name: curr.toLocaleDateString('en-US', { weekday: 'short' }),
                            day_num: curr.getDate(),
                            month_name: curr.toLocaleDateString('en-US', { month: 'short' }),
                            hours,
                            status,
                            isAutoWO,
                            isWeekOffDay,
                            checkIn,
                            checkOut,
                            location,
                            notes
                        });

                        curr.setDate(curr.getDate() + 1);
                    }

                    wHours = Math.round(wHours * 10) / 10;
                    staffMonthHours += wHours;
                    staffMonthTarget += w.target_hours;

                    const ot = wHours >= w.target_hours ? Math.round((wHours - w.target_hours) * 10) / 10 : 0.0;
                    const ut = wHours < w.target_hours ? Math.round((w.target_hours - wHours) * 10) / 10 : 0.0;
                    const wBalance = Math.round((wHours - w.target_hours) * 10) / 10;

                    staffTotalOT += ot;
                    staffTotalUT += ut;

                    return {
                        week_number: w.week_number,
                        label: w.label,
                        target_hours: w.target_hours,
                        worked_hours: wHours,
                        overtime_hours: ot,
                        undertime_hours: ut,
                        net_balance: wBalance,
                        days: wDays
                    };
                });

                staffMonthHours = Math.round(staffMonthHours * 10) / 10;
                staffMonthTarget = Math.round(staffMonthTarget * 10) / 10;
                staffTotalOT = Math.round(staffTotalOT * 10) / 10;
                staffTotalUT = Math.round(staffTotalUT * 10) / 10;
                const netBalance = Math.round((staffTotalOT - staffTotalUT) * 10) / 10;

                totalAggHours += staffMonthHours;
                totalAggOT += staffTotalOT;
                totalAggUT += staffTotalUT;
                if (netBalance > 0) otCount++;
                else if (netBalance < 0) utCount++;

                return {
                    id: staff.id,
                    sl_no: staff.sl_no,
                    employee_code: staff.employee_code,
                    name: staff.name,
                    designation: staff.designation,
                    allocated_to: staff.allocated_to,
                    whatsapp: staff.whatsapp,
                    gmail: staff.gmail || '',
                    image_url: staff.image_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(staff.name)}`,
                    weekly_breakdown: weeklyBreakdown,
                    total_month_hours: staffMonthHours,
                    total_target_hours: staffMonthTarget,
                    total_overtime: staffTotalOT,
                    total_undertime: staffTotalUT,
                    net_monthly_balance: netBalance,
                    days_present_count: daysPresent,
                    days_wo_count: daysWO,
                    missing_count: missingCount,
                    status: netBalance > 0 ? 'OVERTIME' : (netBalance < 0 ? 'UNDERTIME' : 'TARGET_MET')
                };
            });

            return {
                cycle_label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
                weeks,
                stats: {
                    total_staff: activeStaff.length,
                    aggregate_hours: Math.round(totalAggHours * 10) / 10,
                    aggregate_overtime: Math.round(totalAggOT * 10) / 10,
                    aggregate_undertime: Math.round(totalAggUT * 10) / 10,
                    net_aggregate_balance: Math.round((totalAggOT - totalAggUT) * 10) / 10,
                    ot_count: otCount,
                    ut_count: utCount
                },
                staff_reports: staffReports
            };
        });

        // Report for CURRENTLY SELECTED STAFF MEMBER
        const selectedStaffReport = computed(() => {
            if (!reportData.value || !reportData.value.staff_reports || reportData.value.staff_reports.length === 0) {
                return null;
            }
            if (!entryForm.value.staff_name) {
                return reportData.value.staff_reports[0] || null;
            }
            const match = reportData.value.staff_reports.find(s =>
                s.employee_code === entryForm.value.employee_code ||
                s.name.toLowerCase() === entryForm.value.staff_name.toLowerCase()
            );
            return match || reportData.value.staff_reports[0];
        });

        // Filtered Staff Reports (For Organization Summary table)
        const filteredStaffReports = computed(() => {
            if (!reportData.value || !reportData.value.staff_reports) return [];
            return reportData.value.staff_reports.filter(s => {
                if (selectedLoc.value !== 'ALL') {
                    const sel = selectedLoc.value.toLowerCase().trim();
                    const staffAlloc = (s.allocated_to || '').toLowerCase().trim();
                    const workedAtBranch = s.weekly_breakdown && s.weekly_breakdown.some(w =>
                        w.days && w.days.some(d => (d.location || '').toLowerCase().trim() === sel)
                    );
                    if (staffAlloc !== sel && !workedAtBranch) return false;
                }
                if (searchQuery.value) {
                    const q = searchQuery.value.toLowerCase().trim();
                    const mName = s.name.toLowerCase().includes(q);
                    const mCode = s.employee_code.toLowerCase().includes(q);
                    const mDesig = s.designation.toLowerCase().includes(q);
                    if (!mName && !mCode && !mDesig) return false;
                }
                if (statusFilter.value === 'OVERTIME' && s.net_monthly_balance <= 0) return false;
                if (statusFilter.value === 'UNDERTIME' && s.net_monthly_balance >= 0) return false;
                return true;
            });
        });

        const onCycleChange = () => {
            const [y, m] = selectedCycle.value.split('-').map(Number);
            selectedYear.value = y;
            selectedMonth.value = m;
        };

        // -------------------------------------------------------------
        // EXCEL DOWNLOAD (.XLSX) WITH 2 SHEETS: SUMMARY + DAILY
        // -------------------------------------------------------------
        const exportExcel = () => {
            if (!canExportReports.value) {
                showToast("Access Denied: Report download is restricted for Data_Entry role.", "error");
                return;
            }
            if (typeof XLSX === 'undefined') {
                showToast("Loading Excel exporter...", "info");
                return;
            }

            const rep = reportData.value;
            const wb = XLSX.utils.book_new();

            // SHEET 1: Attendance Summary
            const summaryRows = [
                ["STAFF ATTENDANCE REPORT — SUMMARY"],
                [`Period: ${rep.cycle_label}`],
                ["Target: 48 Hours/Week (Monday to Sunday) | Cutoff: 20th to 19th | Thursday & Saturday Auto WO"],
                [],
                [
                    "Sl", "Employee Code", "Employee Name", "Designation", "Branch", "WhatsApp", "Gmail",
                    "W1", "W2", "W3", "W4", "W5 Rem",
                    "Total Hours", "Target Hrs", "Overtime (OT)", "Undertime (UT)", "Net Balance",
                    "Days Present", "Week Offs (WO)", "Missing Days"
                ]
            ];

            rep.staff_reports.forEach(s => {
                const w1 = s.weekly_breakdown[0] ? s.weekly_breakdown[0].worked_hours : 0;
                const w2 = s.weekly_breakdown[1] ? s.weekly_breakdown[1].worked_hours : 0;
                const w3 = s.weekly_breakdown[2] ? s.weekly_breakdown[2].worked_hours : 0;
                const w4 = s.weekly_breakdown[3] ? s.weekly_breakdown[3].worked_hours : 0;
                const w5 = s.weekly_breakdown[4] ? s.weekly_breakdown[4].worked_hours : 0;

                summaryRows.push([
                    s.sl_no,
                    s.employee_code,
                    s.name,
                    s.designation,
                    s.allocated_to,
                    s.whatsapp,
                    s.gmail,
                    w1, w2, w3, w4, w5,
                    s.total_month_hours,
                    s.total_target_hours,
                    s.total_overtime,
                    s.total_undertime,
                    s.net_monthly_balance,
                    s.days_present_count,
                    s.days_wo_count,
                    s.missing_count
                ]);
            });

            const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
            XLSX.utils.book_append_sheet(wb, wsSummary, "Attendance Summary");

            // SHEET 2: Daily Attendance
            const dailyRows = [
                ["STAFF DAILY ATTENDANCE LOGS"],
                [`Period: ${rep.cycle_label}`],
                ["Standard Week Offs: Thursday & Saturday | Target: 48 Hours/Week (Mon to Sun)"],
                [],
                [
                    "Date", "Day", "Employee Code", "Employee Name", "Designation",
                    "Branch / Location", "Status", "From Time", "To Time", "Hours Worked", "Notes"
                ]
            ];

            rep.staff_reports.forEach(s => {
                s.weekly_breakdown.forEach(w => {
                    w.days.forEach(d => {
                        dailyRows.push([
                            d.date,
                            d.day_name,
                            s.employee_code,
                            s.name,
                            s.designation,
                            d.location || s.allocated_to,
                            d.status,
                            d.checkIn || "",
                            d.checkOut || "",
                            d.hours,
                            d.notes || ""
                        ]);
                    });
                });
            });

            const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows);
            XLSX.utils.book_append_sheet(wb, wsDaily, "Daily Attendance");

            XLSX.writeFile(wb, `Staff_Attendance_Report_${selectedYear.value}_${selectedMonth.value}.xlsx`);
            showToast("Downloaded 2-Sheet Excel Report (Summary + Daily Attendance)!");
        };

        const printReport = () => window.print();

        const openWhatsApp = (num) => {
            if (!num) return showToast("No WhatsApp number registered", "error");
            window.open(`https://wa.me/${num.replace(/\D/g, '')}`, '_blank');
        };

        // -------------------------------------------------------------
        // BRANCH VISIT SCHEDULE MODULE
        // -------------------------------------------------------------
        const scheduleForm = ref({
            branch: '',
            location: '',
            visit_date: todayStr,
            visit_time: '09:00',
            allocated_to_staff: '',
            row_index: null,
            is_editing: false
        });

        const scheduleFilterBranch = ref('ALL');
        const scheduleFilterStaff = ref('ALL');
        const scheduleSearchQuery = ref('');

        const onScheduleBranchChange = () => {
            if (!scheduleForm.value.branch) return;
            const match = locations.value.find(l => l.branch === scheduleForm.value.branch);
            if (match) {
                scheduleForm.value.location = match.location || match.emr || '';
            }
        };

        const filteredSchedules = computed(() => {
            return schedulesList.value.filter(sc => {
                if (scheduleFilterBranch.value !== 'ALL' && sc.branch !== scheduleFilterBranch.value) return false;
                if (scheduleFilterStaff.value !== 'ALL' && sc.allocated_to_staff !== scheduleFilterStaff.value) return false;
                if (scheduleSearchQuery.value) {
                    const q = scheduleSearchQuery.value.toLowerCase().trim();
                    const mBranch = (sc.branch || '').toLowerCase().includes(q);
                    const mLoc = (sc.location || '').toLowerCase().includes(q);
                    const mStaff = (sc.allocated_to_staff || '').toLowerCase().includes(q);
                    if (!mBranch && !mLoc && !mStaff) return false;
                }
                return true;
            }).sort((a, b) => (b.visit_date || '').localeCompare(a.visit_date || ''));
        });

        const saveSchedule = async () => {
            if (!scheduleForm.value.branch) {
                return showToast("Please select a Branch", "error");
            }
            if (!scheduleForm.value.visit_date) {
                return showToast("Please select a Visit Date", "error");
            }
            if (!scheduleForm.value.allocated_to_staff) {
                return showToast("Please select a Staff Member", "error");
            }

            const op = scheduleForm.value.is_editing ? 'edit' : 'add';
            const payloadData = {
                branch: scheduleForm.value.branch,
                location: scheduleForm.value.location,
                visit_date: scheduleForm.value.visit_date,
                visit_time: scheduleForm.value.visit_time || '09:00',
                allocated_to_staff: scheduleForm.value.allocated_to_staff
            };

            const success = await sendAdminCrud('Schedule', op, scheduleForm.value.row_index, payloadData);
            if (success) {
                scheduleForm.value.branch = '';
                scheduleForm.value.location = '';
                scheduleForm.value.allocated_to_staff = '';
                scheduleForm.value.is_editing = false;
                scheduleForm.value.row_index = null;
            }
        };

        const editSchedule = (sc) => {
            scheduleForm.value.branch = sc.branch;
            scheduleForm.value.location = sc.location;
            scheduleForm.value.visit_date = sc.visit_date;
            scheduleForm.value.visit_time = sc.visit_time;
            scheduleForm.value.allocated_to_staff = sc.allocated_to_staff;
            scheduleForm.value.row_index = sc.row_index;
            scheduleForm.value.is_editing = true;
            const el = document.getElementById('schedule-form-card');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };

        const deleteSchedule = async (sc) => {
            if (!confirm(`Delete visit schedule to ${sc.branch} on ${sc.visit_date}?`)) return;
            await sendAdminCrud('Schedule', 'delete', sc.row_index, {});
        };

        const cancelScheduleEdit = () => {
            scheduleForm.value.branch = '';
            scheduleForm.value.location = '';
            scheduleForm.value.allocated_to_staff = '';
            scheduleForm.value.is_editing = false;
            scheduleForm.value.row_index = null;
        };

        const exportScheduleExcel = () => {
            if (typeof XLSX === 'undefined') {
                return showToast("Loading Excel exporter...", "info");
            }
            const rows = [
                ["BRANCH VISIT SCHEDULES"],
                [`Exported On: ${new Date().toLocaleString()}`],
                [],
                ["Sl", "Branch", "Location", "Visit Date", "Visit Time", "Allocated to Staff", "Updated By User", "Updated By Date"]
            ];

            filteredSchedules.value.forEach((sc, idx) => {
                rows.push([
                    idx + 1,
                    sc.branch,
                    sc.location,
                    sc.visit_date,
                    sc.visit_time,
                    sc.allocated_to_staff,
                    sc.updated_by_user,
                    sc.updated_by_date
                ]);
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Visit Schedule");
            XLSX.writeFile(wb, `Branch_Visit_Schedule_${todayStr}.xlsx`);
            showToast("Downloaded Branch Visit Schedule Excel!");
        };

        // -------------------------------------------------------------
        // ADMIN PORTAL & CRUD ENGINE (Direct Google Sheet Updates)
        // -------------------------------------------------------------
        const adminActiveTab = ref('staff'); // 'staff' | 'users' | 'allocations' | 'locations' | 'roles'

        // Admin Modals State
        const staffModal = ref({
            open: false,
            isEdit: false,
            rowIndex: null,
            form: { sl_no: '', employee_code: '', name: '', designation: 'Staff', allocated_to: 'HEAD OFFICE', whatsapp: '', image_url: '', gmail: '' }
        });

        const userModal = ref({
            open: false,
            isEdit: false,
            rowIndex: null,
            form: { user_name: '', gmail: '', role: 'Data_Entry' }
        });

        const allocModal = ref({
            open: false,
            isEdit: false,
            rowIndex: null,
            form: { employee_code: '', employee_name: '', allocated_to_code: '', allocated_to_name: '' }
        });

        const locModal = ref({
            open: false,
            isEdit: false,
            rowIndex: null,
            form: { branch: '', emr: '', location: '' }
        });

        const roleModal = ref({
            open: false,
            isEdit: false,
            rowIndex: null,
            form: { role: '', entry_form: '', reports: '', download_excel: '' }
        });

        // Universal CRUD dispatcher to Google Apps Script
        const sendAdminCrud = async (sheetName, operation, rowIndex = null, payloadData = {}) => {
            const url = googleSheetWebAppUrl.value.trim();
            if (!url) {
                showToast("Google Sheet backend not connected!", "error");
                return false;
            }

            loading.value = true;
            const updatedBy = currentUser.value ? (currentUser.value.name || currentUser.value.email) : 'Admin';

            const payload = {
                action: 'admin_crud',
                sheet_name: sheetName,
                operation: operation,
                row_index: rowIndex,
                data: payloadData,
                updated_by_user: updatedBy
            };

            try {
                let resData = null;
                try {
                    const encoded = encodeURIComponent(JSON.stringify(payload));
                    const res = await fetch(`${url}?action=admin_crud&payload=${encoded}`);
                    resData = await res.json();
                } catch(getErr) {
                    const res = await fetch(url, {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    resData = await res.json();
                }

                if (resData && resData.status === 'success') {
                    await syncGoogleSheet(true);
                    showToast(resData.message || "Operation completed successfully!");
                    return true;
                } else {
                    showToast((resData && resData.message) ? resData.message : "Error executing action", "error");
                    return false;
                }
            } catch(err) {
                console.error("Admin CRUD error:", err);
                showToast("Error communicating with Google Sheet: " + (err.message || err), "error");
                return false;
            } finally {
                loading.value = false;
            }
        };

        // Staff CRUD Handlers
        const openAddStaffModal = () => {
            staffModal.value = {
                open: true,
                isEdit: false,
                rowIndex: null,
                form: {
                    sl_no: staffList.value.length + 1,
                    employee_code: '',
                    name: '',
                    designation: 'Inventory Controller',
                    allocated_to: 'DUBAI',
                    whatsapp: '',
                    image_url: '',
                    gmail: ''
                }
            };
        };

        const openEditStaffModal = (s) => {
            staffModal.value = {
                open: true,
                isEdit: true,
                rowIndex: s.row_index,
                form: {
                    sl_no: s.sl_no,
                    employee_code: s.employee_code,
                    name: s.name,
                    designation: s.designation,
                    allocated_to: s.allocated_to,
                    whatsapp: s.whatsapp,
                    image_url: s.image_url,
                    gmail: s.gmail || ''
                }
            };
        };

        const saveStaffModal = async () => {
            if (!staffModal.value.form.name || !staffModal.value.form.employee_code) {
                return showToast("Employee Name and Code are required", "error");
            }
            const op = staffModal.value.isEdit ? 'edit' : 'add';
            const ok = await sendAdminCrud('Staff_data', op, staffModal.value.rowIndex, staffModal.value.form);
            if (ok) staffModal.value.open = false;
        };

        const deleteStaffRecord = async (s) => {
            if (!confirm(`Delete ${s.name} (${s.employee_code}) from Staff Directory?`)) return;
            await sendAdminCrud('Staff_data', 'delete', s.row_index, {});
        };

        // User Access CRUD Handlers
        const openAddUserModal = () => {
            userModal.value = {
                open: true,
                isEdit: false,
                rowIndex: null,
                form: { user_name: '', gmail: '', role: 'Data_Entry' }
            };
        };

        const openEditUserModal = (u) => {
            userModal.value = {
                open: true,
                isEdit: true,
                rowIndex: u.row_index,
                form: { user_name: u.user_name, gmail: u.gmail, role: u.role }
            };
        };

        const saveUserModal = async () => {
            if (!userModal.value.form.gmail) {
                return showToast("Gmail address is required", "error");
            }
            const op = userModal.value.isEdit ? 'edit' : 'add';
            const ok = await sendAdminCrud('Users_Data', op, userModal.value.rowIndex, userModal.value.form);
            if (ok) userModal.value.open = false;
        };

        const deleteUserRecord = async (u) => {
            if (!confirm(`Delete user access for ${u.user_name || u.gmail}?`)) return;
            await sendAdminCrud('Users_Data', 'delete', u.row_index, {});
        };

        // Staff Allocation CRUD Handlers
        const openAddAllocModal = () => {
            allocModal.value = {
                open: true,
                isEdit: false,
                rowIndex: null,
                form: { employee_code: '', employee_name: '', allocated_to_code: '', allocated_to_name: '' }
            };
        };

        const openEditAllocModal = (al) => {
            allocModal.value = {
                open: true,
                isEdit: true,
                rowIndex: al.row_index,
                form: {
                    employee_code: al.employee_code,
                    employee_name: al.employee_name,
                    allocated_to_code: al.allocated_to_code,
                    allocated_to_name: al.allocated_to_name
                }
            };
        };

        const onAllocStaffSelect = (staffObj) => {
            if (!staffObj) return;
            allocModal.value.form.employee_code = staffObj.employee_code;
            allocModal.value.form.employee_name = staffObj.name;
        };

        const onAllocTargetSelect = (targetObj) => {
            if (!targetObj) return;
            allocModal.value.form.allocated_to_code = targetObj.employee_code;
            allocModal.value.form.allocated_to_name = targetObj.name;
        };

        const saveAllocModal = async () => {
            if (!allocModal.value.form.employee_code || !allocModal.value.form.allocated_to_code) {
                return showToast("Both Staff and Assigned User are required", "error");
            }
            const op = allocModal.value.isEdit ? 'edit' : 'add';
            const ok = await sendAdminCrud('User_Allocation', op, allocModal.value.rowIndex, allocModal.value.form);
            if (ok) allocModal.value.open = false;
        };

        const deleteAllocRecord = async (al) => {
            if (!confirm(`Remove allocation: ${al.employee_name} -> ${al.allocated_to_name}?`)) return;
            await sendAdminCrud('User_Allocation', 'delete', al.row_index, {});
        };

        // Location CRUD Handlers
        const openAddLocModal = () => {
            locModal.value = {
                open: true,
                isEdit: false,
                rowIndex: null,
                form: { branch: '', emr: 'DXB', location: 'Dubai' }
            };
        };

        const openEditLocModal = (l) => {
            locModal.value = {
                open: true,
                isEdit: true,
                rowIndex: l.row_index,
                form: { branch: l.branch, emr: l.emr, location: l.location }
            };
        };

        const saveLocModal = async () => {
            if (!locModal.value.form.branch) {
                return showToast("Branch name is required", "error");
            }
            const op = locModal.value.isEdit ? 'edit' : 'add';
            const ok = await sendAdminCrud('Locations', op, locModal.value.rowIndex, locModal.value.form);
            if (ok) locModal.value.open = false;
        };

        const deleteLocRecord = async (l) => {
            if (!confirm(`Delete branch "${l.branch}"?`)) return;
            await sendAdminCrud('Locations', 'delete', l.row_index, {});
        };

        // Roles CRUD Handlers
        const openAddRoleModal = () => {
            roleModal.value = {
                open: true,
                isEdit: false,
                rowIndex: null,
                form: { role: '', entry_form: '✅', reports: '✅', download_excel: '✅' }
            };
        };

        const openEditRoleModal = (r) => {
            roleModal.value = {
                open: true,
                isEdit: true,
                rowIndex: r.row_index,
                form: { role: r.role, entry_form: r.entry_form, reports: r.reports, download_excel: r.download_excel }
            };
        };

        const saveRoleModal = async () => {
            if (!roleModal.value.form.role) {
                return showToast("Role name is required", "error");
            }
            const op = roleModal.value.isEdit ? 'edit' : 'add';
            const ok = await sendAdminCrud('Roles', op, roleModal.value.rowIndex, roleModal.value.form);
            if (ok) roleModal.value.open = false;
        };

        const deleteRoleRecord = async (r) => {
            if (!confirm(`Delete role "${r.role}"?`)) return;
            await sendAdminCrud('Roles', 'delete', r.row_index, {});
        };

        // -------------------------------------------------------------
        // GOOGLE SIGN-IN (GOOGLE IDENTITY SERVICES)
        // -------------------------------------------------------------
        const renderSignInButton = () => {
            if (!config.GOOGLE_CLIENT_ID) {
                authError.value = 'Google Client ID not configured. Please update config.js';
                return;
            }

            const waitForGIS = (retries = 0) => {
                if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
                    try {
                        google.accounts.id.initialize({
                            client_id: config.GOOGLE_CLIENT_ID,
                            callback: handleGoogleAuthCallback,
                            auto_select: false
                        });

                        const btnEl = document.getElementById('google-signin-btn-login');
                        if (btnEl) {
                            btnEl.innerHTML = '';
                            google.accounts.id.renderButton(btnEl, {
                                theme: "filled_blue",
                                size: "large",
                                shape: "pill",
                                width: 300,
                                text: "signin_with"
                            });
                        }
                    } catch (err) {
                        console.warn("Google Auth Init Warning:", err);
                    }
                } else if (retries < 30) {
                    setTimeout(() => waitForGIS(retries + 1), 250);
                } else {
                    authError.value = 'Google Sign-In failed to load. Please refresh the page.';
                }
            };

            nextTick(() => waitForGIS(0));
        };

        const handleGoogleAuthCallback = async (response) => {
            isAuthChecking.value = true;
            authError.value = '';

            try {
                const base64Url = response.credential.split('.')[1];
                const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
                }).join(''));

                const userData = JSON.parse(jsonPayload);
                const userEmail = (userData.email || '').toLowerCase().trim();
                const tokenExp = userData.exp ? userData.exp * 1000 : Date.now() + 86400000;

                const url = googleSheetWebAppUrl.value.trim();
                if (!url) {
                    authError.value = 'Google Sheet backend not configured. Contact administrator.';
                    isAuthChecking.value = false;
                    return;
                }

                const res = await fetch(`${url}?action=get_all`);
                const data = await res.json();

                if (data.status !== 'success') {
                    authError.value = 'Could not connect to backend. Try again later.';
                    isAuthChecking.value = false;
                    return;
                }

                if (data.staff && Array.isArray(data.staff)) staffList.value = data.staff;
                if (data.locations && Array.isArray(data.locations)) locations.value = data.locations;
                if (data.attendance && Array.isArray(data.attendance)) attendanceLogs.value = data.attendance;
                if (data.users && Array.isArray(data.users)) usersList.value = data.users;
                if (data.allocations && Array.isArray(data.allocations)) allocationsList.value = data.allocations;
                if (data.schedules && Array.isArray(data.schedules)) schedulesList.value = data.schedules;
                if (data.roles && Array.isArray(data.roles)) rolesList.value = data.roles;

                // Match user in Users_Data
                let matchedUser = usersList.value.find(u =>
                    u.gmail && u.gmail.toLowerCase().trim() === userEmail
                );

                // Fallback check
                if (!matchedUser && usersList.value.length === 0) {
                    const legacyStaff = staffList.value.find(s =>
                        (s.gmail || '').toLowerCase().trim() === userEmail
                    );
                    if (legacyStaff) {
                        matchedUser = {
                            user_name: legacyStaff.name,
                            gmail: userEmail,
                            role: userEmail.includes('shuhaib') ? 'Admin' : 'Data_Entry'
                        };
                    }
                }

                if (matchedUser) {
                    const role = matchedUser.role || 'Data_Entry';
                    const matchedStaff = staffList.value.find(s =>
                        s.name && matchedUser.user_name &&
                        s.name.toLowerCase().trim() === matchedUser.user_name.toLowerCase().trim()
                    );

                    currentUser.value = {
                        name: userData.name,
                        userName: matchedUser.user_name || userData.name,
                        email: userEmail,
                        picture: userData.picture,
                        role: role,
                        staff: matchedStaff || null,
                        exp: tokenExp
                    };

                    localStorage.setItem('attendance_auth_user', JSON.stringify(currentUser.value));
                    sheetConnectionStatus.value = 'connected';
                    sheetLastSyncTime.value = new Date().toLocaleTimeString();

                    if (canDataEntry.value && matchedStaff) {
                        selectStaffForEntry(matchedStaff);
                    } else if (canDataEntry.value && visibleStaffList.value.length > 0 && !entryForm.value.staff_name) {
                        selectStaffForEntry(visibleStaffList.value[0]);
                    }

                    if (role === 'Report_Only') {
                        currentTab.value = 'summary';
                    }

                    showToast(`Welcome, ${userData.name}! Logged in as ${role === 'Data_Entry' ? 'Data Entry' : (role === 'Report_Only' ? 'Report Only' : 'Admin')}.`);
                } else {
                    authError.value = `Access Denied: ${userEmail} is not registered in Users_Data sheet. Please contact your administrator to grant access.`;
                    localStorage.removeItem('attendance_auth_user');
                    currentUser.value = null;
                    staffList.value = [];
                    locations.value = [];
                    attendanceLogs.value = [];
                    usersList.value = [];
                }

            } catch (err) {
                console.error("Auth Error:", err);
                authError.value = 'Authentication failed. Please try again.';
            } finally {
                isAuthChecking.value = false;
            }
        };

        const tryRestoreSession = async () => {
            const savedUser = localStorage.getItem('attendance_auth_user');
            if (!savedUser) return false;

            try {
                const userData = JSON.parse(savedUser);

                if (userData.exp && Date.now() > userData.exp) {
                    localStorage.removeItem('attendance_auth_user');
                    return false;
                }

                currentUser.value = userData;
                initialLoading.value = true;

                const url = googleSheetWebAppUrl.value.trim();
                if (!url) {
                    currentUser.value = null;
                    initialLoading.value = false;
                    localStorage.removeItem('attendance_auth_user');
                    return false;
                }

                const res = await fetch(`${url}?action=get_all`);
                const data = await res.json();

                if (data.status === 'success') {
                    if (data.staff && Array.isArray(data.staff)) staffList.value = data.staff;
                    if (data.locations && Array.isArray(data.locations)) locations.value = data.locations;
                    if (data.attendance && Array.isArray(data.attendance)) attendanceLogs.value = data.attendance;
                    if (data.users && Array.isArray(data.users)) usersList.value = data.users;
                    if (data.allocations && Array.isArray(data.allocations)) allocationsList.value = data.allocations;
                    if (data.schedules && Array.isArray(data.schedules)) schedulesList.value = data.schedules;
                    if (data.roles && Array.isArray(data.roles)) rolesList.value = data.roles;

                    const userEmail = (userData.email || '').toLowerCase().trim();
                    let matchedUser = usersList.value.find(u =>
                        u.gmail && u.gmail.toLowerCase().trim() === userEmail
                    );

                    if (!matchedUser && usersList.value.length === 0) {
                        const legacyStaff = staffList.value.find(s =>
                            (s.gmail || '').toLowerCase().trim() === userEmail
                        );
                        if (legacyStaff) {
                            matchedUser = {
                                user_name: legacyStaff.name,
                                gmail: userEmail,
                                role: userData.role || (userEmail.includes('shuhaib') ? 'Admin' : 'Data_Entry')
                            };
                        }
                    }

                    if (matchedUser) {
                        const role = matchedUser.role || userData.role || 'Data_Entry';
                        const matchedStaff = staffList.value.find(s =>
                            s.name && matchedUser.user_name &&
                            s.name.toLowerCase().trim() === matchedUser.user_name.toLowerCase().trim()
                        );

                        currentUser.value.role = role;
                        currentUser.value.userName = matchedUser.user_name || userData.userName;
                        currentUser.value.staff = matchedStaff || userData.staff || null;

                        localStorage.setItem('attendance_auth_user', JSON.stringify(currentUser.value));
                        sheetConnectionStatus.value = 'connected';
                        sheetLastSyncTime.value = new Date().toLocaleTimeString();

                        if (canDataEntry.value && matchedStaff && !entryForm.value.staff_name) {
                            selectStaffForEntry(matchedStaff);
                        }

                        initialLoading.value = false;
                        return true;
                    } else {
                        currentUser.value = null;
                        localStorage.removeItem('attendance_auth_user');
                        staffList.value = [];
                        locations.value = [];
                        attendanceLogs.value = [];
                        usersList.value = [];
                        initialLoading.value = false;
                        return false;
                    }
                } else {
                    initialLoading.value = false;
                    return true;
                }

            } catch (e) {
                console.warn("Session restore failed:", e);
                localStorage.removeItem('attendance_auth_user');
                currentUser.value = null;
                initialLoading.value = false;
                return false;
            }
        };

        const signOut = () => {
            currentUser.value = null;
            localStorage.removeItem('attendance_auth_user');
            staffList.value = [];
            locations.value = [];
            attendanceLogs.value = [];
            usersList.value = [];
            allocationsList.value = [];
            schedulesList.value = [];
            rolesList.value = [];
            entryForm.value.staff_name = '';
            entryForm.value.employee_code = '';
            entryForm.value.staff_id = null;
            staffSearchQuery.value = '';
            showToast("Signed out successfully.");
            nextTick(() => renderSignInButton());
        };

        const retryLogin = () => {
            authError.value = '';
            renderSignInButton();
        };

        // -------------------------------------------------------------
        // AUTO-REFRESH EVERY 1 HOUR & INITIALIZATION
        // -------------------------------------------------------------
        onMounted(async () => {
            const today = new Date();
            let cYear = today.getFullYear();
            let cMonth = today.getMonth() + 1;
            if (today.getDate() < 20) {
                cMonth = cMonth === 1 ? 12 : cMonth - 1;
                cYear = cMonth === 12 ? cYear - 1 : cYear;
            }
            selectedYear.value = cYear;
            selectedMonth.value = cMonth;
            selectedCycle.value = `${cYear}-${cMonth}`;

            const restored = await tryRestoreSession();
            if (!restored) {
                renderSignInButton();
            }

            const refreshIntervalMs = (config.AUTO_REFRESH_MINUTES || 60) * 60 * 1000;
            setInterval(() => {
                if (currentUser.value && googleSheetWebAppUrl.value) {
                    console.log("1-Hour Auto-Refresh: Refreshing attendance & schedules...");
                    syncGoogleSheet(true);
                }
            }, refreshIntervalMs);
        });

        return {
            currentTab,
            loading,
            initialLoading,
            todayStr,
            toastMessage,
            toastType,
            googleSheetWebAppUrl,
            sheetConnectionStatus,
            sheetLastSyncTime,
            currentUser,
            userRole,
            isAdmin,
            canDataEntry,
            canExportReports,
            isAuthChecking,
            authError,
            signOut,
            retryLogin,
            availableCycles,
            selectedCycle,
            selectedYear,
            selectedMonth,
            locations,
            sortedLocations,
            selectedLoc,
            searchQuery,
            statusFilter,
            staffList,
            visibleStaffList,
            usersList,
            allocationsList,
            schedulesList,
            rolesList,
            reportData,
            selectedStaffReport,
            filteredStaffReports,
            entryForm,
            staffSearchQuery,
            showStaffDropdown,
            matchedStaffList,
            locationSearchQuery,
            matchedLocations,
            entryDateDayInfo,
            selectStaffForEntry,
            quickLogDate,
            updateEntryHours,
            submitAttendanceEntry,
            syncGoogleSheet,
            onCycleChange,
            exportExcel,
            printReport,
            openWhatsApp,
            // Schedule Module
            scheduleForm,
            scheduleFilterBranch,
            scheduleFilterStaff,
            scheduleSearchQuery,
            filteredSchedules,
            onScheduleBranchChange,
            saveSchedule,
            editSchedule,
            deleteSchedule,
            cancelScheduleEdit,
            exportScheduleExcel,
            // Admin Portal
            adminActiveTab,
            staffModal,
            userModal,
            allocModal,
            locModal,
            roleModal,
            openAddStaffModal,
            openEditStaffModal,
            saveStaffModal,
            deleteStaffRecord,
            openAddUserModal,
            openEditUserModal,
            saveUserModal,
            deleteUserRecord,
            openAddAllocModal,
            openEditAllocModal,
            onAllocStaffSelect,
            onAllocTargetSelect,
            saveAllocModal,
            deleteAllocRecord,
            openAddLocModal,
            openEditLocModal,
            saveLocModal,
            deleteLocRecord,
            openAddRoleModal,
            openEditRoleModal,
            saveRoleModal,
            deleteRoleRecord
        };
    }
});

app.mount('#app');
