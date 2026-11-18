const { createApp, ref, computed, onMounted, watch } = Vue;

const app = createApp({
    setup() {
        // Navigation State
        const currentTab = ref('reports'); // 'reports', 'weekly', 'grid', 'staff', 'sync', 'settings'
        const loading = ref(false);
        const toastMessage = ref('');
        const toastType = ref('success');

        // Google Sheet Connection State (Saved in LocalStorage for GitHub Pages!)
        const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y/edit?usp=sharing";
        const googleSheetWebAppUrl = ref(localStorage.getItem('attendance_gas_url') || '');
        const sheetConnectionStatus = ref('unconnected'); // 'connected', 'connecting', 'unconnected', 'error'
        const sheetLastSyncTime = ref(localStorage.getItem('attendance_last_sync') || '');

        // Business & Filter State
        const todayStr = new Date().toISOString().split('T')[0];
        const selectedYear = ref(2026);
        const selectedMonth = ref(10);
        const selectedCycle = ref('2026-10');
        const selectedLoc = ref('ALL');
        const searchQuery = ref('');
        const statusFilter = ref('ALL');

        // Master Data
        const staffList = ref([]);
        const locations = ref([]);
        const attendanceLogs = ref([]);

        // Weekly View State
        const selectedWeekNum = ref(1);

        // Daily Grid Matrix State
        const gridDays = ref([]);
        const gridRows = ref([]);
        const gridDirty = ref(false);

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
            shift_type: 'Regular',
            location: 'DUBAI',
            notes: ''
        });

        // Smart Search Autocomplete States
        const staffSearchQuery = ref('');
        const showStaffDropdown = ref(false);
        const locationSearchQuery = ref('');
        const showLocationDropdown = ref(false);

        // Modals
        const connectModal = ref(false);
        const detailModal = ref({ open: false, staffReport: null });

        // Baseline Fallback Staff (Matches Google Sheet Staff_data)
        const BASELINE_STAFF = [
            { id: 1, sl_no: 1, employee_code: "INV-001", name: "Shuhaib Muhammed Chirakkattil", designation: "Inventory Manager", allocated_to: "HEAD OFFICE", whatsapp: "502247162" },
            { id: 2, sl_no: 2, employee_code: "INV-002", name: "Amal Valsan Kumar", designation: "Inventory Controller", allocated_to: "DUBAI", whatsapp: "561775239" },
            { id: 3, sl_no: 3, employee_code: "INV-003", name: "Alan Mathew Varghese", designation: "Inventory Controller", allocated_to: "RAK", whatsapp: "565637002" },
            { id: 4, sl_no: 4, employee_code: "INV-004", name: "Jebin Shanthi Susaiah", designation: "Inventory Controller", allocated_to: "RAK", whatsapp: "568211967" },
            { id: 5, sl_no: 5, employee_code: "INV-005", name: "Athul Kalamkoli Mahendran", designation: "Inventory Controller", allocated_to: "FUJAIRAH", whatsapp: "559436074" },
            { id: 6, sl_no: 6, employee_code: "INV-006", name: "Kevin Paul Poulose", designation: "Inventory Controller", allocated_to: "ABU DHABI", whatsapp: "568518636" },
            { id: 7, sl_no: 7, employee_code: "INV-007", name: "Arun Suresh", designation: "Inventory Controller", allocated_to: "ABU DHABI", whatsapp: "504160943" },
            { id: 8, sl_no: 8, employee_code: "INV-008", name: "Muhammed Shibil", designation: "Inventory Controller", allocated_to: "DUBAI", whatsapp: "568269041" },
            { id: 9, sl_no: 9, employee_code: "INV-009", name: "Sujith Kumar Maladukkam Vasanth", designation: "Inventory Controller", allocated_to: "ABU DHABI", whatsapp: "589077644" },
            { id: 10, sl_no: 10, employee_code: "INV-010", name: "Jince Mathew Thulasi Mathew", designation: "Inventory Controller", allocated_to: "SHARJAH", whatsapp: "581347472" },
            { id: 11, sl_no: 11, employee_code: "INV-011", name: "Pawan Deep Singh Bupinder Singh", designation: "Inventory Helper", allocated_to: "ABU DHABI", whatsapp: "" },
            { id: 12, sl_no: 12, employee_code: "INV-012", name: "Sikender Singh", designation: "Inventory Helper", allocated_to: "DUBAI", whatsapp: "917009441420" },
            { id: 13, sl_no: 13, employee_code: "INV-013", name: "Gurudeep Singh Karnail Singh", designation: "Inventory Helper", allocated_to: "ABU DHABI", whatsapp: "919646000717" },
            { id: 14, sl_no: 14, employee_code: "INV-014", name: "Rahul Mast Ram", designation: "Inventory Helper", allocated_to: "DUBAI", whatsapp: "" },
            { id: 15, sl_no: 15, employee_code: "INV-015", name: "Gagandeep Singh Mohinder Pal", designation: "Inventory Helper", allocated_to: "SHARJAH", whatsapp: "" },
            { id: 16, sl_no: 16, employee_code: "3002", name: "Masood (ID: 3002)", designation: "Inventory Helper", allocated_to: "DUBAI", whatsapp: "" },
            { id: 17, sl_no: 17, employee_code: "2987", name: "Sooraj (ID: 2987)", designation: "Inventory Helper", allocated_to: "RAK", whatsapp: "" },
            { id: 18, sl_no: 18, employee_code: "2999", name: "Farhan (ID: 2999)", designation: "Inventory Helper", allocated_to: "ABU DHABI", whatsapp: "" },
            { id: 19, sl_no: 19, employee_code: "INV-019", name: "YOGESH RAVINDER CHHIBBER", designation: "Inventory Helper", allocated_to: "FUJAIRAH", whatsapp: "" },
        ];

        // Baseline Fallback Locations (Matches Google Sheet Locations)
        const BASELINE_LOCATIONS = [
            { id: 1, branch: "HEAD OFFICE", emr: "Dubai", location: "Head Office - Dubai" },
            { id: 2, branch: "DUBAI", emr: "Dubai", location: "Dubai Central Warehouse" },
            { id: 3, branch: "ABU DHABI", emr: "Abu Dhabi", location: "Abu Dhabi Branch" },
            { id: 4, branch: "RAK", emr: "Ras Al Khaimah", location: "RAK Depot" },
            { id: 5, branch: "FUJAIRAH", emr: "Fujairah", location: "Fujairah Distribution" },
            { id: 6, branch: "SHARJAH", emr: "Sharjah", location: "Sharjah Logistics Center" }
        ];

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
            if (!staffSearchQuery.value) return staffList.value.slice(0, 8);
            const q = staffSearchQuery.value.toLowerCase().trim();
            return staffList.value.filter(s =>
                s.name.toLowerCase().includes(q) ||
                (s.employee_code && s.employee_code.toLowerCase().includes(q)) ||
                (s.designation && s.designation.toLowerCase().includes(q))
            ).slice(0, 10);
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
            entryForm.value.staff_id = s.id;
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
                if (outMin < inMin) outMin += 24 * 60; // Overnight
                const diff = (outMin - inMin - (entryForm.value.break_minutes || 0)) / 60.0;
                entryForm.value.total_hours = parseFloat(Math.max(0, diff).toFixed(2));
            } catch (e) {
                // ignore
            }
        };

        // Day name info
        const entryDateDayInfo = computed(() => {
            if (!entryForm.value.date) return { name: '', isWeekend: false };
            const d = new Date(entryForm.value.date);
            const dayNum = d.getDay(); // 0=Sun, 5=Fri
            const name = d.toLocaleDateString('en-US', { weekday: 'long' });
            return {
                name,
                isWeekend: dayNum === 0 || dayNum === 5
            };
        });

        watch(() => entryForm.value.status, () => updateEntryHours());

        // -------------------------------------------------------------
        // GOOGLE SHEETS LIVE DATA SYNC ENGINE
        // -------------------------------------------------------------
        const syncGoogleSheet = async () => {
            if (!googleSheetWebAppUrl.value) {
                connectModal.value = true;
                return;
            }

            loading.value = true;
            sheetConnectionStatus.value = 'connecting';
            try {
                const res = await fetch(`${googleSheetWebAppUrl.value}?action=get_all`);
                const data = await res.json();

                if (data.status === 'success') {
                    if (data.staff && data.staff.length > 0) {
                        staffList.value = data.staff;
                        localStorage.setItem('attendance_cached_staff', JSON.stringify(data.staff));
                    }
                    if (data.locations && data.locations.length > 0) {
                        locations.value = data.locations;
                        localStorage.setItem('attendance_cached_locations', JSON.stringify(data.locations));
                    }
                    if (data.attendance) {
                        attendanceLogs.value = data.attendance;
                        localStorage.setItem('attendance_cached_logs', JSON.stringify(data.attendance));
                    }

                    sheetConnectionStatus.value = 'connected';
                    const now = new Date().toLocaleTimeString();
                    sheetLastSyncTime.value = now;
                    localStorage.setItem('attendance_last_sync', now);
                    showToast(`Synced! Loaded ${staffList.value.length} Staff & ${locations.value.length} Locations from Google Sheet.`);
                } else {
                    sheetConnectionStatus.value = 'error';
                    showToast("Google Sheet returned unexpected format", "error");
                }
            } catch (err) {
                console.error("Google Sheet Sync Error:", err);
                sheetConnectionStatus.value = 'error';
                showToast("Could not connect to Google Sheet Web App", "error");
            } finally {
                loading.value = false;
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
                showToast("Please select an employee first", "error");
                return;
            }
            if (!entryForm.value.date) {
                showToast("Please select a date", "error");
                return;
            }
            if (entryForm.value.date > todayStr) {
                showToast("Future dates are not allowed. Please enter today or a past date.", "error");
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
                notes: entryForm.value.notes,
                allow_update: allowUpdate
            };

            try {
                // If Google Sheet Web App is connected, push directly to Google Sheet
                if (googleSheetWebAppUrl.value) {
                    const res = await fetch(googleSheetWebAppUrl.value, {
                        method: 'POST',
                        body: JSON.stringify(payload)
                    });
                    const data = await res.json();

                    if (data.status === 'duplicate') {
                        if (confirm(`Duplicate Entry: Attendance is already logged for ${entryForm.value.staff_name} on ${entryForm.value.date}.\n\nDo you want to overwrite/update this existing record?`)) {
                            await submitAttendanceEntry(true);
                        }
                        loading.value = false;
                        return;
                    }
                }

                // Also try local API if running via Python server
                try {
                    await fetch(`/api/attendance/punch?allow_update=${allowUpdate ? 'true' : 'false'}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } catch (e) {
                    // Running on static GitHub Pages without Python server
                }

                // Update local memory and cache
                const existingIdx = attendanceLogs.value.findIndex(l => l.employee_code === payload.employee_code && l.date === payload.date);
                if (existingIdx >= 0) {
                    attendanceLogs.value[existingIdx] = payload;
                } else {
                    attendanceLogs.value.unshift(payload);
                }
                localStorage.setItem('attendance_cached_logs', JSON.stringify(attendanceLogs.value));

                showToast(`Recorded ${payload.status} (${payload.total_hours}h) for ${payload.name} on ${payload.date}!`);

                // CRITICAL REQUIREMENT:
                // "keep the previously entered data. like the user name for example, the user can enter any past date and add entry."
                // Retain: staff_id, staff_name, employee_code, location, check_in, check_out
                entryForm.value.notes = '';

            } catch (err) {
                console.error("Submit Attendance Error:", err);
                showToast("Error recording attendance", "error");
            } finally {
                loading.value = false;
            }
        };

        // -------------------------------------------------------------
        // SIMPLE REPORTS & 48-HOUR WEEKLY CALCULATIONS
        // -------------------------------------------------------------
        const getCutoffDates = (year, month) => {
            const start = new Date(year, month - 1, 20);
            let endMonth = month;
            let endYear = year;
            if (month === 12) {
                endMonth = 1;
                endYear = year + 1;
            }
            const end = new Date(endYear, endMonth, 19);
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
                    // Prorate working days (excluding Friday & Sunday)
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
                    start_date: curr.toISOString().split('T')[0],
                    end_date: wEnd.toISOString().split('T')[0],
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
            const currYear = 2026;
            for (let m = 7; m <= 12; m++) {
                const sDate = new Date(currYear, m - 1, 20);
                const nextM = m === 12 ? 1 : m + 1;
                const nextY = m === 12 ? currYear + 1 : currYear;
                const eDate = new Date(nextY, nextM - 1, 19);

                list.push({
                    year: currYear,
                    month: m,
                    key: `${currYear}-${m}`,
                    label: `${sDate.toLocaleDateString('en-US', { month: 'long' })} 20, ${currYear} – ${eDate.toLocaleDateString('en-US', { month: 'long' })} 19, ${nextY}`
                });
            }
            return list;
        });

        // Compute Full Attendance Report
        const reportData = computed(() => {
            const { start, end } = getCutoffDates(selectedYear.value, selectedMonth.value);
            const weeks = partitionWeeks(start, end);

            // Index attendance logs
            const logsMap = {};
            attendanceLogs.value.forEach(log => {
                const key = `${log.employee_code}_${log.date}`;
                logsMap[key] = log;
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
                let daysLeave = 0;

                const weeklyBreakdown = weeks.map(w => {
                    let wHours = 0;
                    const wDays = [];
                    const wStart = new Date(w.start_date);
                    const wEnd = new Date(w.end_date);
                    let curr = new Date(wStart);

                    while (curr <= wEnd) {
                        const dateStr = curr.toISOString().split('T')[0];
                        const dayOfWeek = curr.getDay(); // 0=Sun, 5=Fri
                        const logKey = `${staff.employee_code}_${dateStr}`;
                        const log = logsMap[logKey];

                        let status = "Not Logged";
                        let hours = 0.0;
                        let isAutoWO = false;

                        if (log) {
                            status = log.status || "Present";
                            hours = parseFloat(log.total_hours) || 0.0;
                        } else {
                            // AUTOMATIC FRIDAY & SUNDAY "WO" RULE!
                            if (dayOfWeek === 0 || dayOfWeek === 5) {
                                status = "WO";
                                hours = 0.0;
                                isAutoWO = true;
                            }
                        }

                        if (status === 'Present') daysPresent++;
                        else if (status === 'WO') daysWO++;
                        else if (['Paid Leave', 'Sick Leave', 'Unpaid Leave', 'OFF', 'Holiday'].includes(status)) daysLeave++;

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
                    const ut = wHours < w.target_hours ? Math.round((w.target_hours - w.target_hours) * 10) / 10 : 0.0;
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
                    image_url: staff.image_url || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(staff.name)}`,
                    weekly_breakdown: weeklyBreakdown,
                    total_month_hours: staffMonthHours,
                    total_target_hours: staffMonthTarget,
                    total_overtime: staffTotalOT,
                    total_undertime: staffTotalUT,
                    net_monthly_balance: netBalance,
                    days_present_count: daysPresent,
                    days_wo_count: daysWO,
                    days_leave_count: daysLeave,
                    status: netBalance > 0 ? 'OVERTIME' : (netBalance < 0 ? 'UNDERTIME' : 'TARGET_MET')
                };
            });

            return {
                cycle_label: `${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
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
                if (statusFilter.value === 'BALANCED' && s.net_monthly_balance !== 0) return false;
                return true;
            });
        });

        const onCycleChange = () => {
            const [y, m] = selectedCycle.value.split('-').map(Number);
            selectedYear.value = y;
            selectedMonth.value = m;
        };

        // -------------------------------------------------------------
        // EXPORT FORMATTED EXCEL (.XLSX) WITH CLIENT-SIDE SHEETJS
        // -------------------------------------------------------------
        const exportExcel = () => {
            if (typeof XLSX === 'undefined') {
                showToast("Loading Excel exporter...", "info");
                return;
            }

            const rep = reportData.value;
            const wb = XLSX.utils.book_new();

            // 1. Summary Sheet
            const summaryRows = [
                ["STAFF ATTENDANCE REPORT", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                [`Period: ${rep.cycle_label}`, "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                ["Standard: 48 Hours/Week | Automatic WO on Friday & Sunday | Cutoff 20th to 19th", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
                [],
                [
                    "Sl", "Employee Code", "Employee Name", "Designation", "Branch", "WhatsApp",
                    "W1 (48h)", "W2 (48h)", "W3 (48h)", "W4 (48h)", "W5 Rem",
                    "Total Hours", "Target Hrs", "Overtime (OT)", "Undertime (UT)", "Net Balance",
                    "Days Present", "Week Offs (WO)", "Leaves/Off"
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
                    s.days_wo_count,
                    s.days_leave_count
                ]);
            });

            const ws1 = XLSX.utils.aoa_to_sheet(summaryRows);
            XLSX.utils.book_append_sheet(wb, ws1, "Attendance Summary");

            XLSX.writeFile(wb, `Staff_Attendance_Report_${selectedYear.value}_${selectedMonth.value}.xlsx`);
            showToast("Excel report downloaded successfully!");
        };

        const printReport = () => window.print();

        const openWhatsApp = (num) => {
            if (!num) return showToast("No WhatsApp number registered", "error");
            window.open(`https://wa.me/${num.replace(/\D/g, '')}`, '_blank');
        };

        const viewStaffDetail = (s) => {
            detailModal.value.staffReport = s;
            detailModal.value.open = true;
        };

        // Initialize Data
        onMounted(async () => {
            // 1. Try loading cached data
            const cachedStaff = localStorage.getItem('attendance_cached_staff');
            const cachedLocations = localStorage.getItem('attendance_cached_locations');
            const cachedLogs = localStorage.getItem('attendance_cached_logs');

            staffList.value = cachedStaff ? JSON.parse(cachedStaff) : BASELINE_STAFF;
            locations.value = cachedLocations ? JSON.parse(cachedLocations) : BASELINE_LOCATIONS;
            attendanceLogs.value = cachedLogs ? JSON.parse(cachedLogs) : [];

            if (staffList.value.length > 0) {
                selectStaffForEntry(staffList.value[0]);
            }

            // 2. If Google Sheet Web App URL exists, auto-sync
            if (googleSheetWebAppUrl.value) {
                await syncGoogleSheet();
            } else {
                // Also check if local python backend has seed
                try {
                    const res = await fetch('/api/staff');
                    if (res.ok) {
                        const data = await res.json();
                        if (data.staff && data.staff.length > 0) {
                            staffList.value = data.staff;
                        }
                    }
                    const lRes = await fetch('/api/locations');
                    if (lRes.ok) {
                        const lData = await lRes.json();
                        if (lData.locations && lData.locations.length > 0) {
                            locations.value = lData.locations;
                        }
                    }
                } catch (e) {
                    // Running on static GitHub Pages
                }
            }
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
            selectedWeekNum,
            entryForm,
            staffSearchQuery,
            showStaffDropdown,
            matchedStaffList,
            locationSearchQuery,
            showLocationDropdown,
            matchedLocations,
            entryDateDayInfo,
            detailModal,
            selectStaffForEntry,
            selectLocationForEntry,
            updateEntryHours,
            submitAttendanceEntry,
            syncGoogleSheet,
            saveGoogleSheetUrl,
            onCycleChange,
            exportExcel,
            printReport,
            openWhatsApp,
            viewStaffDetail
        };
    }
});

app.mount('#app');
