const { createApp, ref, computed, onMounted, watch } = Vue;

const app = createApp({
    setup() {
        // App Configuration
        const config = window.APP_CONFIG || {
            GOOGLE_SCRIPT_URL: '',
            AUTO_REFRESH_MINUTES: 60,
            CUTOFF_START_DAY: 20,
            CUTOFF_END_DAY: 19,
            WEEKLY_TARGET_HOURS: 48.0
        };

        // Navigation State
        const currentTab = ref('reports'); // 'reports', 'staff', 'sync'
        const loading = ref(false);
        const toastMessage = ref('');
        const toastType = ref('success');

        // Google Sheet Connection State
        const googleSheetWebAppUrl = ref(config.GOOGLE_SCRIPT_URL || localStorage.getItem('attendance_gas_url') || '');
        const sheetConnectionStatus = ref('unconnected'); // 'connected', 'connecting', 'unconnected', 'error'
        const sheetLastSyncTime = ref(localStorage.getItem('attendance_last_sync') || '');

        // Master Dynamic Data (100% EMPTY ON START - LOADED ONLY FROM GOOGLE SHEET)
        const staffList = ref([]);
        const locations = ref([]);
        const attendanceLogs = ref([]);

        // Date Helpers (Timezone safe)
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

        const todayStr = getTodayLocalStr();

        // Cutoff & Filter State
        const selectedYear = ref(new Date().getFullYear());
        const selectedMonth = ref(new Date().getMonth() + 1);
        const selectedCycle = ref('');
        const selectedLoc = ref('ALL');
        const searchQuery = ref('');
        const statusFilter = ref('ALL');

        // Smart Attendance Entry Form State (RETAINS PREVIOUS DATA FOR SEQUENTIAL ENTRY!)
        const entryForm = ref({
            staff_id: null,
            staff_name: '',
            employee_code: '',
            date: todayStr,
            status: 'Present',          // Present, WO, OFF, Paid Leave, Sick Leave, Unpaid Leave, Holiday
            check_in: '08:00',
            check_out: '17:00',
            break_minutes: 0,
            total_hours: 9.0,
            location: '',
            notes: ''
        });

        // Smart Search Autocomplete States
        const staffSearchQuery = ref('');
        const showStaffDropdown = ref(false);
        const locationSearchQuery = ref('');
        const showLocationDropdown = ref(false);

        // Modals
        const connectModal = ref(false);

        // Toast Helper
        const showToast = (msg, type = 'success') => {
            toastMessage.value = msg;
            toastType.value = type;
            setTimeout(() => {
                toastMessage.value = '';
            }, 3500);
        };

        // Filtered staff for autocomplete search
        const matchedStaffList = computed(() => {
            if (!staffSearchQuery.value) return staffList.value.slice(0, 10);
            const q = staffSearchQuery.value.toLowerCase().trim();
            return staffList.value.filter(s =>
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.employee_code && s.employee_code.toLowerCase().includes(q)) ||
                (s.designation && s.designation.toLowerCase().includes(q))
            ).slice(0, 12);
        });

        // Filtered locations for smart branch selector
        const matchedLocations = computed(() => {
            if (!locationSearchQuery.value) return locations.value;
            const q = locationSearchQuery.value.toLowerCase().trim();
            return locations.value.filter(loc =>
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
                entryForm.value.location = s.allocated_to;
            }
        };

        const selectLocationForEntry = (loc) => {
            entryForm.value.location = loc.branch;
            locationSearchQuery.value = loc.branch;
            showLocationDropdown.value = false;
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
                // ignore parse errors
            }
        };

        // Selected Date Day Info (Timezone Safe)
        const entryDateDayInfo = computed(() => {
            if (!entryForm.value.date) return { name: '', isWeekend: false };
            const parts = entryForm.value.date.split('-').map(Number);
            const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
            const dayNum = d.getDay(); // 0=Sun, 5=Fri
            const name = d.toLocaleDateString('en-US', { weekday: 'long' });
            return {
                name,
                isWeekend: dayNum === 0 || dayNum === 5 // Sunday (0) and Friday (5) in UAE schedule
            };
        });

        watch(() => entryForm.value.status, () => updateEntryHours());

        // -------------------------------------------------------------
        // LIVE GOOGLE SHEET DATA SYNC
        // -------------------------------------------------------------
        const syncGoogleSheet = async (isBackground = false) => {
            const url = googleSheetWebAppUrl.value.trim();
            if (!url) {
                if (!isBackground) connectModal.value = true;
                return;
            }

            if (!isBackground) loading.value = true;
            sheetConnectionStatus.value = 'connecting';

            try {
                const res = await fetch(`${url}?action=get_all`);
                const data = await res.json();

                if (data.status === 'success') {
                    // Update Staff from 'Staff_data'
                    if (data.staff && Array.isArray(data.staff)) {
                        staffList.value = data.staff;
                    }
                    // Update Locations from 'Locations'
                    if (data.locations && Array.isArray(data.locations)) {
                        locations.value = data.locations;
                        if (!entryForm.value.location && data.locations.length > 0) {
                            entryForm.value.location = data.locations[0].branch;
                        }
                    }
                    // Update Attendance from 'Attendance_data'
                    if (data.attendance && Array.isArray(data.attendance)) {
                        attendanceLogs.value = data.attendance;
                    }

                    // Auto-select first staff if none selected
                    if (!entryForm.value.staff_name && staffList.value.length > 0) {
                        selectStaffForEntry(staffList.value[0]);
                    }

                    sheetConnectionStatus.value = 'connected';
                    const now = new Date().toLocaleTimeString();
                    sheetLastSyncTime.value = now;
                    localStorage.setItem('attendance_last_sync', now);

                    if (!isBackground) {
                        showToast(`Connected! Loaded ${staffList.value.length} Staff & ${locations.value.length} Locations.`);
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

        const saveGoogleSheetUrl = () => {
            const url = googleSheetWebAppUrl.value.trim();
            localStorage.setItem('attendance_gas_url', url);
            connectModal.value = false;
            if (url) {
                syncGoogleSheet();
            }
        };

        // -------------------------------------------------------------
        // SUBMIT ATTENDANCE (ADD BUTTON)
        // -------------------------------------------------------------
        const submitAttendanceEntry = async (allowUpdate = false) => {
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
                allow_update: allowUpdate
            };

            try {
                if (googleSheetWebAppUrl.value) {
                    let data = null;
                    try {
                        const res = await fetch(googleSheetWebAppUrl.value, {
                            method: 'POST',
                            body: JSON.stringify(payload)
                        });
                        data = await res.json();
                    } catch (postErr) {
                        // Fallback to GET for restrictive firewalls
                        const encoded = encodeURIComponent(JSON.stringify(payload));
                        const fallbackRes = await fetch(`${googleSheetWebAppUrl.value}?action=log_attendance&payload=${encoded}`);
                        data = await fallbackRes.json();
                    }

                    if (data && data.status === 'duplicate') {
                        if (confirm(`Duplicate Entry: Attendance is already logged for ${entryForm.value.staff_name} on ${entryForm.value.date}.\n\nDo you want to update this existing record?`)) {
                            await submitAttendanceEntry(true);
                        }
                        loading.value = false;
                        return;
                    }
                }

                // Update local logs in memory
                const existingIdx = attendanceLogs.value.findIndex(l => (l.employee_code === payload.employee_code || l.name === payload.name) && l.date === payload.date);
                if (existingIdx >= 0) {
                    attendanceLogs.value[existingIdx] = payload;
                } else {
                    attendanceLogs.value.unshift(payload);
                }

                showToast(`Recorded ${payload.status} (${payload.total_hours}h) for ${payload.name} on ${payload.date}!`);

                // CRITICAL REQUIREMENT:
                // Keep the previously entered data (staff, code, location, times) so user can immediately add another date!
                entryForm.value.notes = '';

            } catch (err) {
                console.error("Submit Attendance Error:", err);
                showToast("Error recording attendance to Google Sheet", "error");
            } finally {
                loading.value = false;
            }
        };

        // -------------------------------------------------------------
        // SIMPLE REPORTS & 48-HOUR WEEKLY CALCULATIONS
        // -------------------------------------------------------------
        const getCutoffDates = (year, month) => {
            const start = new Date(year, month - 1, 20, 12, 0, 0);
            const end = (month === 12)
                ? new Date(year + 1, 0, 19, 12, 0, 0)
                : new Date(year, month, 19, 12, 0, 0);
            return { start, end };
        };

        const partitionWeeks = (start, end) => {
            const weeks = [];
            let curr = new Date(start);
            let wNum = 1;
            while (curr <= end) {
                let wEnd = new Date(curr);
                wEnd.setDate(wEnd.getDate() + 6);
                if (wEnd > end) wEnd = new Date(end);

                const daysCount = Math.round((wEnd - curr) / (1000 * 60 * 60 * 24)) + 1;
                let target = 48.0;
                if (daysCount < 7) {
                    // Prorate working days (excluding Friday=5 & Sunday=0)
                    let workdays = 0;
                    let temp = new Date(curr);
                    while (temp <= wEnd) {
                        const day = temp.getDay();
                        if (day !== 0 && day !== 5) workdays++;
                        temp.setDate(temp.getDate() + 1);
                    }
                    target = Math.round(workdays * 9.6 * 10) / 10;
                }

                weeks.push({
                    week_number: wNum,
                    start_date: formatDateLocal(curr),
                    end_date: formatDateLocal(wEnd),
                    days_count: daysCount,
                    target_hours: target,
                    label: `Week ${wNum} (${curr.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${wEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
                });

                curr.setDate(curr.getDate() + daysCount);
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

        // Compute Full Attendance Report
        const reportData = computed(() => {
            if (staffList.value.length === 0) {
                return {
                    cycle_label: 'No Cycle Selected',
                    weeks: [],
                    stats: { total_staff: 0, aggregate_hours: 0, aggregate_overtime: 0, aggregate_undertime: 0, net_aggregate_balance: 0, ot_count: 0, ut_count: 0 },
                    staff_reports: []
                };
            }

            const { start, end } = getCutoffDates(selectedYear.value, selectedMonth.value);
            const weeks = partitionWeeks(start, end);

            // Index attendance logs by employee_code + date AND name + date
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

            const staffReports = staffList.value.map(staff => {
                let staffMonthHours = 0;
                let staffMonthTarget = 0;
                let staffTotalOT = 0;
                let staffTotalUT = 0;
                let daysPresent = 0;
                let daysWO = 0;

                const weeklyBreakdown = weeks.map(w => {
                    let wHours = 0;
                    const wDays = [];
                    const wStartParts = w.start_date.split('-').map(Number);
                    const wEndParts = w.end_date.split('-').map(Number);
                    let curr = new Date(wStartParts[0], wStartParts[1] - 1, wStartParts[2], 12, 0, 0);
                    const endD = new Date(wEndParts[0], wEndParts[1] - 1, wEndParts[2], 12, 0, 0);

                    while (curr <= endD) {
                        const dateStr = formatDateLocal(curr);
                        const dayOfWeek = curr.getDay(); // 0=Sun, 5=Fri
                        const log = logsMap[`${staff.employee_code}_${dateStr}`] || logsMap[`${staff.name}_${dateStr}`];

                        let status = "Not Logged";
                        let hours = 0.0;
                        let isAutoWO = false;

                        if (log) {
                            status = log.status || "Present";
                            hours = parseFloat(log.total_hours) || 0.0;
                        } else {
                            // Automatic Week Off on Friday & Sunday!
                            if (dayOfWeek === 0 || dayOfWeek === 5) {
                                status = "WO";
                                hours = 0.0;
                                isAutoWO = true;
                            }
                        }

                        if (status === 'Present') daysPresent++;
                        else if (status === 'WO') daysWO++;

                        wHours += hours;
                        wDays.push({
                            date: dateStr,
                            day_name: curr.toLocaleDateString('en-US', { weekday: 'short' }),
                            day_num: curr.getDate(),
                            hours,
                            status,
                            isAutoWO
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
                    status: netBalance > 0 ? 'OVERTIME' : (netBalance < 0 ? 'UNDERTIME' : 'TARGET_MET')
                };
            });

            return {
                cycle_label: `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
                weeks,
                stats: {
                    total_staff: staffList.value.length,
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

        // Filtered Staff Reports
        const filteredStaffReports = computed(() => {
            if (!reportData.value || !reportData.value.staff_reports) return [];
            return reportData.value.staff_reports.filter(s => {
                if (selectedLoc.value !== 'ALL' && s.allocated_to !== selectedLoc.value) return false;
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
        // EXCEL DOWNLOAD (.XLSX) WITH CLIENT-SIDE SHEETJS
        // -------------------------------------------------------------
        const exportExcel = () => {
            if (typeof XLSX === 'undefined') {
                showToast("Loading Excel exporter...", "info");
                return;
            }

            const rep = reportData.value;
            const wb = XLSX.utils.book_new();

            const summaryRows = [
                ["STAFF ATTENDANCE REPORT"],
                [`Period: ${rep.cycle_label}`],
                ["Target: 48 Hours/Week | Cutoff: 20th to 19th | Fri & Sun Auto WO"],
                [],
                [
                    "Sl", "Employee Code", "Employee Name", "Designation", "Branch", "WhatsApp",
                    "W1 (48h)", "W2 (48h)", "W3 (48h)", "W4 (48h)", "W5 Rem",
                    "Total Hours", "Target Hrs", "Overtime (OT)", "Undertime (UT)", "Net Balance",
                    "Days Present", "Week Offs (WO)"
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
                    w1, w2, w3, w4, w5,
                    s.total_month_hours,
                    s.total_target_hours,
                    s.total_overtime,
                    s.total_undertime,
                    s.net_monthly_balance,
                    s.days_present_count,
                    s.days_wo_count
                ]);
            });

            const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
            XLSX.utils.book_append_sheet(wb, ws1, "Attendance Summary");
            XLSX.writeFile(wb, `Staff_Attendance_Report_${selectedYear.value}_${selectedMonth.value}.xlsx`);
            showToast("Excel report downloaded!");
        };

        const printReport = () => window.print();

        const openWhatsApp = (num) => {
            if (!num) return showToast("No WhatsApp number registered", "error");
            window.open(`https://wa.me/${num.replace(/\D/g, '')}`, '_blank');
        };

        // -------------------------------------------------------------
        // AUTO-REFRESH EVERY 1 HOUR & INITIALIZATION
        // -------------------------------------------------------------
        onMounted(async () => {
            // Determine active cycle for today
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

            // Sync from Google Sheet if URL exists
            if (googleSheetWebAppUrl.value) {
                await syncGoogleSheet();
            } else {
                sheetConnectionStatus.value = 'unconnected';
            }

            // AUTO-RELOAD EVERY 1 HOUR (3600000 ms)
            const refreshIntervalMs = (config.AUTO_REFRESH_MINUTES || 60) * 60 * 1000;
            setInterval(() => {
                if (googleSheetWebAppUrl.value) {
                    console.log("1-Hour Auto-Refresh: Refreshing attendance data from Google Sheet...");
                    syncGoogleSheet(true);
                }
            }, refreshIntervalMs);
        });

        return {
            currentTab,
            loading,
            todayStr,
            toastMessage,
            toastType,
            googleSheetWebAppUrl,
            sheetConnectionStatus,
            sheetLastSyncTime,
            connectModal,
            availableCycles,
            selectedCycle,
            selectedYear,
            selectedMonth,
            locations,
            selectedLoc,
            searchQuery,
            statusFilter,
            staffList,
            reportData,
            filteredStaffReports,
            entryForm,
            staffSearchQuery,
            showStaffDropdown,
            matchedStaffList,
            locationSearchQuery,
            showLocationDropdown,
            matchedLocations,
            entryDateDayInfo,
            selectStaffForEntry,
            selectLocationForEntry,
            updateEntryHours,
            submitAttendanceEntry,
            syncGoogleSheet,
            saveGoogleSheetUrl,
            onCycleChange,
            exportExcel,
            printReport,
            openWhatsApp
        };
    }
});

app.mount('#app');
