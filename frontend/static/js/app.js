const { createApp, ref, computed, onMounted, watch } = Vue;

const app = createApp({
    setup() {
        // Navigation State
        const currentTab = ref('reports'); // 'entry', 'reports', 'weekly', 'grid', 'staff', 'admin', 'sync', 'settings'
        const loading = ref(false);
        const toastMessage = ref('');
        const toastType = ref('success');

        // Business & Filter State
        const cycles = ref([]);
        const selectedCycle = ref(null);
        const selectedYear = ref(2026);
        const selectedMonth = ref(10);
        const departments = ref([]);
        const selectedDept = ref('');
        const locations = ref([]);
        const selectedLoc = ref('ALL');
        const searchQuery = ref('');
        const statusFilter = ref('ALL'); // 'ALL', 'OVERTIME', 'UNDERTIME', 'BALANCED'

        // Core Data
        const reportData = ref(null);
        const staffList = ref([]);
        const settings = ref({});
        const syncLogs = ref([]);
        const syncLoading = ref(false);
        const appsScriptData = ref({ script: '', instructions: [] });

        // Weekly View State
        const selectedWeekNum = ref(1);

        // Daily Grid Matrix State
        const gridDays = ref([]);
        const gridRows = ref([]);
        const gridDirty = ref(false);

        // Smart Attendance Entry Form State (Persists previous entry values!)
        const todayStr = new Date().toISOString().split('T')[0];
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

        // Smart Search Staff Autocomplete State
        const staffSearchQuery = ref('');
        const showStaffDropdown = ref(false);

        // Smart Search Location Autocomplete State
        const locationSearchQuery = ref('');
        const showLocationDropdown = ref(false);

        // Modals
        const staffModal = ref({
            open: false,
            isEdit: false,
            id: null,
            sl_no: null,
            employee_code: '',
            name: '',
            designation: 'Inventory Controller',
            department_id: '',
            allocated_to: 'DUBAI',
            whatsapp: ''
        });

        const locationModal = ref({
            open: false,
            branch: '',
            emr: '',
            location: ''
        });

        const deptModal = ref({
            open: false,
            name: '',
            description: ''
        });

        const detailModal = ref({
            open: false,
            staffReport: null
        });

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

        // Filtered locations for smart location dropdown
        const matchedLocations = computed(() => {
            if (!locationSearchQuery.value) return locations.value;
            const q = locationSearchQuery.value.toLowerCase().trim();
            return locations.value.filter(loc =>
                (loc.branch && loc.branch.toLowerCase().includes(q)) ||
                (loc.emr && loc.emr.toLowerCase().includes(q)) ||
                (loc.location && loc.location.toLowerCase().includes(q))
            );
        });

        // Select staff from autocomplete
        const selectStaffForEntry = (s) => {
            entryForm.value.staff_id = s.id;
            entryForm.value.staff_name = s.name;
            entryForm.value.employee_code = s.employee_code;
            staffSearchQuery.value = `${s.name} (${s.employee_code})`;
            showStaffDropdown.value = false;

            // Auto-set location to staff's default allocated branch if not set
            if (s.allocated_to) {
                entryForm.value.location = s.allocated_to;
            }
        };

        // Select location from dropdown
        const selectLocationForEntry = (loc) => {
            entryForm.value.location = loc.branch;
            locationSearchQuery.value = loc.branch;
            showLocationDropdown.value = false;
        };

        // Calculate hours live in entry form
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
                if (outMin < inMin) outMin += 24 * 60; // overnight
                const diff = (outMin - inMin - (entryForm.value.break_minutes || 0)) / 60.0;
                entryForm.value.total_hours = parseFloat(Math.max(0, diff).toFixed(2));
            } catch (e) {
                // ignore
            }
        };

        // Selected Date day-name helper
        const entryDateDayInfo = computed(() => {
            if (!entryForm.value.date) return { name: '', isWeekend: false };
            const d = new Date(entryForm.value.date);
            const dayNum = d.getDay(); // 0=Sun, 5=Fri
            const name = d.toLocaleDateString('en-US', { weekday: 'long' });
            return {
                name,
                isWeekend: dayNum === 0 || dayNum === 5 // Sunday or Friday in UAE schedule
            };
        });

        // Watch status changes to auto-adjust hours
        watch(() => entryForm.value.status, (newStatus) => {
            updateEntryHours();
        });

        // SUBMIT ATTENDANCE ENTRY (ADD BUTTON)
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
            try {
                const payload = {
                    staff_id: entryForm.value.staff_id,
                    date: entryForm.value.date,
                    check_in: entryForm.value.status === 'Present' ? entryForm.value.check_in : '',
                    check_out: entryForm.value.status === 'Present' ? entryForm.value.check_out : '',
                    break_minutes: entryForm.value.break_minutes || 0,
                    total_hours: entryForm.value.total_hours,
                    status: entryForm.value.status,
                    shift_type: entryForm.value.shift_type || 'Regular',
                    location: entryForm.value.location,
                    notes: entryForm.value.notes
                };

                const url = `/api/attendance/punch?allow_update=${allowUpdate ? 'true' : 'false'}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();

                if (res.ok) {
                    showToast(data.message || `Attendance added for ${entryForm.value.staff_name}!`, "success");

                    // Refresh report & grid
                    await fetchReport();

                    // CRUCIAL REQUIREMENT:
                    // "keep the previously entered data. like the user name for example, the user can enter any past date and add entry."
                    // We retain: staff_id, staff_name, employee_code, location, check_in, check_out, break_minutes.
                    // We only optionally clear notes and let user pick next date!
                    entryForm.value.notes = '';
                } else {
                    if (res.status === 409) {
                        // Duplicate entry detected
                        if (confirm(`Duplicate Entry: Attendance is already logged for ${entryForm.value.staff_name} on ${entryForm.value.date}.\n\nDo you want to overwrite/update this existing record?`)) {
                            await submitAttendanceEntry(true);
                        }
                    } else {
                        showToast(data.detail || "Error adding attendance", "error");
                    }
                }
            } catch (err) {
                console.error(err);
                showToast("Server communication error", "error");
            } finally {
                loading.value = false;
            }
        };

        // API Client Functions
        const fetchCycles = async () => {
            try {
                const res = await fetch('/api/reports/cycles');
                const data = await res.json();
                cycles.value = data.cycles || [];
                const current = cycles.value.find(c => c.is_current) || cycles.value[0];
                if (current) {
                    selectedCycle.value = `${current.year}-${current.month}`;
                    selectedYear.value = current.year;
                    selectedMonth.value = current.month;
                }
            } catch (err) {
                console.error("Error fetching cycles:", err);
            }
        };

        const fetchDepartments = async () => {
            try {
                const res = await fetch('/api/departments');
                const data = await res.json();
                departments.value = data.departments || [];
                if (departments.value.length > 0 && !staffModal.value.department_id) {
                    staffModal.value.department_id = departments.value[0].id;
                }
            } catch (err) {
                console.error("Error fetching departments:", err);
            }
        };

        const fetchLocations = async () => {
            try {
                const res = await fetch('/api/locations');
                const data = await res.json();
                locations.value = data.locations || [];
                if (locations.value.length > 0 && !entryForm.value.location) {
                    entryForm.value.location = locations.value[0].branch;
                }
            } catch (err) {
                console.error("Error fetching locations:", err);
            }
        };

        const fetchStaff = async () => {
            try {
                const res = await fetch('/api/staff');
                const data = await res.json();
                staffList.value = data.staff || [];
                if (staffList.value.length > 0 && !entryForm.value.staff_id) {
                    selectStaffForEntry(staffList.value[0]);
                }
            } catch (err) {
                console.error("Error fetching staff:", err);
            }
        };

        const fetchSettings = async () => {
            try {
                const res = await fetch('/api/settings');
                const data = await res.json();
                settings.value = data.settings || {};
            } catch (err) {
                console.error("Error fetching settings:", err);
            }
        };

        const fetchSheetsConfig = async () => {
            try {
                const res = await fetch('/api/sheets/config');
                const data = await res.json();
                syncLogs.value = data.sync_logs || [];
                const resScript = await fetch('/api/sheets/apps-script-code');
                appsScriptData.value = await resScript.json();
            } catch (err) {
                console.error("Error fetching sheets config:", err);
            }
        };

        const fetchReport = async () => {
            loading.value = true;
            try {
                let url = `/api/reports/cutoff-summary?year=${selectedYear.value}&month=${selectedMonth.value}`;
                if (selectedDept.value) url += `&department_id=${selectedDept.value}`;
                if (selectedLoc.value && selectedLoc.value !== 'ALL') url += `&location=${selectedLoc.value}`;

                const res = await fetch(url);
                const data = await res.json();
                reportData.value = data;
                buildDailyGrid(data);
            } catch (err) {
                console.error("Error fetching report:", err);
                showToast("Failed to load attendance report", "error");
            } finally {
                loading.value = false;
            }
        };

        // Build 30-day Daily Spreadsheet Grid (reflects WO for Fri & Sun!)
        const buildDailyGrid = (data) => {
            if (!data || !data.cycle_info || !data.staff_reports) return;

            const start = new Date(data.cycle_info.start_date);
            const end = new Date(data.cycle_info.end_date);
            const days = [];

            let curr = new Date(start);
            while (curr <= end) {
                const iso = curr.toISOString().split('T')[0];
                const dayOfWeek = curr.getDay(); // 0=Sun, 5=Fri
                days.push({
                    date: iso,
                    dayNum: curr.getDate(),
                    dayName: curr.toLocaleDateString('en-US', { weekday: 'short' }),
                    isWO: dayOfWeek === 0 || dayOfWeek === 5
                });
                curr.setDate(curr.getDate() + 1);
            }
            gridDays.value = days;

            gridRows.value = data.staff_reports.map(s => {
                const hoursMap = {};
                const statusMap = {};
                if (s.weekly_breakdown) {
                    s.weekly_breakdown.forEach(w => {
                        w.days.forEach(d => {
                            hoursMap[d.date] = d.hours || 0;
                            statusMap[d.date] = d.status || (d.is_auto_wo ? 'WO' : 'Present');
                        });
                    });
                }
                return {
                    staff_id: s.staff_id,
                    sl_no: s.sl_no,
                    employee_code: s.employee_code,
                    name: s.name,
                    designation: s.designation,
                    allocated_to: s.allocated_to,
                    whatsapp: s.whatsapp,
                    hours: hoursMap,
                    statuses: statusMap
                };
            });
            gridDirty.value = false;
        };

        const getGridRowTotal = (row) => {
            if (!row || !row.hours) return 0;
            return Object.values(row.hours).reduce((acc, h) => acc + (parseFloat(h) || 0), 0);
        };

        const onGridCellChange = (row, dateStr, val) => {
            const num = parseFloat(val) || 0;
            row.hours[dateStr] = Math.max(0, Math.min(24, num));
            gridDirty.value = true;
        };

        const saveGridAttendance = async () => {
            loading.value = true;
            try {
                const entries = [];
                gridRows.value.forEach(row => {
                    Object.entries(row.hours).forEach(([dateStr, hrs]) => {
                        entries.push({
                            staff_id: row.staff_id,
                            date: dateStr,
                            total_hours: parseFloat(hrs) || 0,
                            status: (parseFloat(hrs) > 0) ? 'Present' : (row.statuses[dateStr] || 'Present')
                        });
                    });
                });

                const res = await fetch('/api/attendance/bulk-daily', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ entries })
                });

                if (res.ok) {
                    showToast("Attendance grid saved successfully!");
                    gridDirty.value = false;
                    await fetchReport();
                } else {
                    showToast("Failed to save attendance grid", "error");
                }
            } catch (err) {
                console.error("Error saving grid:", err);
                showToast("Error saving attendance", "error");
            } finally {
                loading.value = false;
            }
        };

        const onCycleChange = () => {
            if (selectedCycle.value) {
                const [y, m] = selectedCycle.value.split('-').map(Number);
                selectedYear.value = y;
                selectedMonth.value = m;
                fetchReport();
            }
        };

        const filteredStaffReports = computed(() => {
            if (!reportData.value || !reportData.value.staff_reports) return [];
            return reportData.value.staff_reports.filter(s => {
                if (searchQuery.value) {
                    const q = searchQuery.value.toLowerCase();
                    const matchName = s.name.toLowerCase().includes(q);
                    const matchCode = (s.employee_code || '').toLowerCase().includes(q);
                    const matchDesig = s.designation.toLowerCase().includes(q);
                    if (!matchName && !matchCode && !matchDesig) return false;
                }
                if (statusFilter.value !== 'ALL') {
                    if (statusFilter.value === 'OVERTIME' && s.net_monthly_balance <= 0) return false;
                    if (statusFilter.value === 'UNDERTIME' && s.net_monthly_balance >= 0) return false;
                    if (statusFilter.value === 'BALANCED' && s.net_monthly_balance !== 0) return false;
                }
                return true;
            });
        });

        const activeWeekInfo = computed(() => {
            if (!reportData.value || !reportData.value.cycle_info) return null;
            const weeks = reportData.value.cycle_info.weeks || [];
            return weeks.find(w => w.week_number === selectedWeekNum.value) || weeks[0];
        });

        // Staff CRUD
        const openAddStaffModal = () => {
            staffModal.value = {
                open: true,
                isEdit: false,
                id: null,
                sl_no: (staffList.value.length + 1),
                employee_code: `INV-${String(staffList.value.length + 1).padStart(3, '0')}`,
                name: '',
                designation: 'Inventory Controller',
                department_id: departments.value[0]?.id || 1,
                allocated_to: locations.value[0]?.branch || 'DUBAI',
                whatsapp: ''
            };
        };

        const openEditStaffModal = (s) => {
            staffModal.value = {
                open: true,
                isEdit: true,
                id: s.id || s.staff_id,
                sl_no: s.sl_no,
                employee_code: s.employee_code,
                name: s.name,
                designation: s.designation,
                department_id: s.department_id,
                allocated_to: s.allocated_to,
                whatsapp: s.whatsapp || ''
            };
        };

        const submitStaff = async () => {
            try {
                const isEdit = staffModal.value.isEdit;
                const url = isEdit ? `/api/staff/${staffModal.value.id}` : '/api/staff';
                const method = isEdit ? 'PUT' : 'POST';

                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(staffModal.value)
                });

                if (res.ok) {
                    showToast(isEdit ? "Staff updated successfully" : "Staff added successfully");
                    staffModal.value.open = false;
                    await fetchStaff();
                    await fetchReport();
                } else {
                    const err = await res.json();
                    showToast(err.detail || "Error saving staff", "error");
                }
            } catch (err) {
                console.error(err);
                showToast("Server error saving staff", "error");
            }
        };

        const deleteStaff = async (staffId) => {
            if (!confirm("Are you sure you want to deactivate this staff member?")) return;
            try {
                const res = await fetch(`/api/staff/${staffId}`, { method: 'DELETE' });
                if (res.ok) {
                    showToast("Staff deactivated");
                    await fetchStaff();
                    await fetchReport();
                }
            } catch (err) {
                console.error(err);
            }
        };

        // Department CRUD
        const openAddDeptModal = () => {
            deptModal.value = { open: true, name: '', description: '' };
        };

        const submitDepartment = async () => {
            try {
                const res = await fetch('/api/departments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(deptModal.value)
                });
                if (res.ok) {
                    showToast("Department created successfully");
                    deptModal.value.open = false;
                    await fetchDepartments();
                } else {
                    const err = await res.json();
                    showToast(err.detail || "Error creating department", "error");
                }
            } catch (err) {
                console.error(err);
            }
        };

        // Location CRUD
        const openAddLocationModal = () => {
            locationModal.value = { open: true, branch: '', emr: '', location: '' };
        };

        const submitLocation = async () => {
            try {
                const res = await fetch('/api/locations', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(locationModal.value)
                });
                if (res.ok) {
                    showToast("Branch location added successfully");
                    locationModal.value.open = false;
                    await fetchLocations();
                } else {
                    const err = await res.json();
                    showToast(err.detail || "Error adding location", "error");
                }
            } catch (err) {
                console.error(err);
            }
        };

        // Settings Save
        const saveSettings = async () => {
            try {
                const res = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings.value)
                });
                if (res.ok) {
                    showToast("Settings updated successfully");
                    await fetchSettings();
                    await fetchReport();
                }
            } catch (err) {
                console.error(err);
            }
        };

        // Google Sheets Sync
        const triggerSync = async () => {
            syncLoading.value = true;
            try {
                const res = await fetch('/api/sheets/sync', { method: 'POST' });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message || "Synced with Google Sheets!");
                    await fetchSheetsConfig();
                    await fetchLocations();
                    await fetchStaff();
                    await fetchReport();
                } else {
                    showToast("Sync failed", "error");
                }
            } catch (err) {
                console.error(err);
                showToast("Sync error", "error");
            } finally {
                syncLoading.value = false;
            }
        };

        const copyScriptCode = () => {
            navigator.clipboard.writeText(appsScriptData.value.script);
            showToast("Google Apps Script code copied to clipboard!");
        };

        // Exports & Utilities
        const exportExcel = () => {
            const url = `/api/reports/export/excel?year=${selectedYear.value}&month=${selectedMonth.value}`;
            window.location.href = url;
        };

        const exportCSV = () => {
            const url = `/api/reports/export/csv?year=${selectedYear.value}&month=${selectedMonth.value}`;
            window.location.href = url;
        };

        const printReport = () => {
            window.print();
        };

        const openWhatsApp = (num) => {
            if (!num) {
                showToast("No WhatsApp number registered for this employee", "error");
                return;
            }
            const clean = num.replace(/\D/g, '');
            window.open(`https://wa.me/${clean}`, '_blank');
        };

        const viewStaffDetail = (s) => {
            detailModal.value.staffReport = s;
            detailModal.value.open = true;
        };

        onMounted(async () => {
            await fetchCycles();
            await fetchDepartments();
            await fetchLocations();
            await fetchStaff();
            await fetchSettings();
            await fetchReport();
            await fetchSheetsConfig();
        });

        return {
            currentTab,
            loading,
            todayStr,
            toastMessage,
            toastType,
            cycles,
            selectedCycle,
            selectedYear,
            selectedMonth,
            departments,
            selectedDept,
            locations,
            selectedLoc,
            searchQuery,
            statusFilter,
            reportData,
            staffList,
            settings,
            syncLogs,
            syncLoading,
            appsScriptData,
            selectedWeekNum,
            gridDays,
            gridRows,
            gridDirty,
            entryForm,
            staffSearchQuery,
            showStaffDropdown,
            matchedStaffList,
            locationSearchQuery,
            showLocationDropdown,
            matchedLocations,
            entryDateDayInfo,
            staffModal,
            locationModal,
            deptModal,
            detailModal,
            filteredStaffReports,
            activeWeekInfo,
            selectStaffForEntry,
            selectLocationForEntry,
            updateEntryHours,
            submitAttendanceEntry,
            onCycleChange,
            onGridCellChange,
            getGridRowTotal,
            saveGridAttendance,
            openAddStaffModal,
            openEditStaffModal,
            submitStaff,
            deleteStaff,
            openAddDeptModal,
            submitDepartment,
            openAddLocationModal,
            submitLocation,
            saveSettings,
            triggerSync,
            copyScriptCode,
            exportExcel,
            exportCSV,
            printReport,
            openWhatsApp,
            viewStaffDetail
        };
    }
});

app.mount('#app');
