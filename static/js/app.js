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
        const loadingText = ref('Processing & Syncing...');
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

        // -------------------------------------------------------------
        // BULLETPROOF NETWORK LAYER (CORS, Multi-Account & JSONP Shield)
        // -------------------------------------------------------------
        const jsonpRequest = (url, timeoutMs = 20000) => {
            return new Promise((resolve, reject) => {
                const callbackName = 'sheet_jsonp_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
                let timeoutId = null;

                window[callbackName] = (data) => {
                    cleanup();
                    resolve(data);
                };

                const cleanup = () => {
                    if (timeoutId) clearTimeout(timeoutId);
                    delete window[callbackName];
                    const el = document.getElementById(callbackName);
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                };

                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error("Network timeout: Google Sheet took too long to respond."));
                }, timeoutMs);

                const script = document.createElement('script');
                script.id = callbackName;
                const sep = url.includes('?') ? '&' : '?';
                script.src = `${url}${sep}callback=${callbackName}`;
                script.onerror = () => {
                    cleanup();
                    reject(new Error("Unable to reach Google Sheet script (Script tag blocked or offline)."));
                };

                document.head.appendChild(script);
            });
        };

        const apiGet = async (action, queryParams = {}) => {
            const baseUrl = googleSheetWebAppUrl.value.trim();
            if (!baseUrl) throw new Error("Google Sheet backend not configured in config.js.");

            const urlObj = new URL(baseUrl);
            urlObj.searchParams.set('action', action);
            for (const [k, v] of Object.entries(queryParams)) {
                if (v !== undefined && v !== null) {
                    urlObj.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
                }
            }
            urlObj.searchParams.set('_t', Date.now());
            const targetUrl = urlObj.toString();

            // 1. Fetch with credentials: 'omit' (CRITICAL: prevents Google multi-login CORS redirect)
            try {
                const res = await fetch(targetUrl, {
                    method: 'GET',
                    mode: 'cors',
                    credentials: 'omit',
                    cache: 'no-store'
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === 'object') return data;
                }
            } catch (fetchErr) {
                console.warn(`[apiGet] fetch failed for ${action}, trying JSONP fallback:`, fetchErr);
            }

            // 2. Fallback to JSONP (immune to CORS and cookies)
            try {
                return await jsonpRequest(targetUrl);
            } catch (jsonpErr) {
                console.error(`[apiGet] JSONP also failed for ${action}:`, jsonpErr);
                throw new Error("Could not connect to Google Sheet backend. Please check your internet connection.");
            }
        };

        const apiPost = async (payload = {}) => {
            const baseUrl = googleSheetWebAppUrl.value.trim();
            if (!baseUrl) throw new Error("Google Sheet backend not configured in config.js.");

            // 1. Try POST with simple body (no OPTIONS preflight) and credentials: 'omit'
            try {
                const res = await fetch(baseUrl, {
                    method: 'POST',
                    mode: 'cors',
                    credentials: 'omit',
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data && typeof data === 'object') return data;
                }
            } catch (postErr) {
                console.warn("[apiPost] POST fetch failed, falling back to GET:", postErr);
            }

            // 2. Fallback to GET via apiGet if payload fits in URL query
            const payloadStr = JSON.stringify(payload);
            const encoded = encodeURIComponent(payloadStr);
            if (encoded.length < 5000) {
                return await apiGet(payload.action || 'log_attendance', { payload: encoded });
            }

            throw new Error("Unable to save data to Google Sheet. Please check your connection.");
        };

        // Computed Role & Permission Helpers
        const userRole = computed(() => {
            if (!currentUser.value) return '';
            const email = (currentUser.value.email || '').toLowerCase().trim();
            if (currentUser.value.role) return currentUser.value.role;
            if (email === 'shuhaibonly@gmail.com') return 'Admin';
            return 'Data_Entry';
        });
        const isAdmin = computed(() => userRole.value === 'Admin');
        const canDataEntry = computed(() => userRole.value === 'Admin' || userRole.value === 'Data_Entry');
        const canExportReports = computed(() => userRole.value === 'Admin' || userRole.value === 'Report_Only');
        const userCountry = computed(() => {
            if (!currentUser.value) return '';
            return (currentUser.value.country || '').toUpperCase().trim();
        });

        // Staff Visibility strictly based on User_Allocation sheet
        // Admin & Report_Only see ALL staff; Data_Entry users only see their allocated staff
        const visibleStaffList = computed(() => {
            if (staffList.value.length === 0) return [];
            if (isAdmin.value || userRole.value === 'Report_Only') {
                return staffList.value;
            }

            if (!currentUser.value) return [];
            const myEmpCode = currentUser.value.staff ? (currentUser.value.staff.employee_code || '').toString().trim() : '';
            const myName = (currentUser.value.userName || currentUser.value.name || '').toLowerCase().trim();
            const myEmail = (currentUser.value.email || '').toLowerCase().trim();

            // Find allocation rows where current user is the assigned controller (Allocated to Employee Name / Code)
            const myAllocRows = allocationsList.value.filter(al => {
                const targetCode = (al.allocated_to_code || '').toString().trim();
                const targetName = (al.allocated_to_name || '').toLowerCase().trim();
                return (myEmpCode && targetCode === myEmpCode) ||
                       (targetName && (targetName === myName || myName.includes(targetName) || targetName.includes(myName)));
            });

            if (myAllocRows.length > 0) {
                const allowedCodes = new Set(myAllocRows.map(a => (a.employee_code || '').toString().trim()).filter(Boolean));
                const allowedNames = new Set(myAllocRows.map(a => (a.employee_name || '').toLowerCase().trim()).filter(Boolean));

                // Always include the user themselves if they have a staff profile
                if (myEmpCode) allowedCodes.add(myEmpCode);
                if (myName) allowedNames.add(myName);

                const filtered = staffList.value.filter(s =>
                    allowedCodes.has((s.employee_code || '').toString().trim()) ||
                    allowedNames.has((s.name || '').toLowerCase().trim())
                );
                return filtered;
            }

            // Fallback: If no allocation row exists in User_Allocation sheet,
            // strictly show ONLY the user's own profile (never leak others)
            if (currentUser.value.staff) {
                return [currentUser.value.staff];
            }

            const selfStaff = staffList.value.filter(s =>
                (myEmail && s.gmail && s.gmail.toLowerCase().trim() === myEmail) ||
                (myName && s.name && s.name.toLowerCase().trim() === myName)
            );
            return selfStaff;
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
        const showLocationDropdown = ref(false);

        // Toast Helper
        const showToast = (msg, type = 'success') => {
            toastMessage.value = msg;
            toastType.value = type;
            setTimeout(() => {
                toastMessage.value = '';
            }, 3500);
        };

        // Filtered staff with smart multi-word in-between substring search (respects user's allocation!)
        const matchedStaffList = computed(() => {
            const baseList = visibleStaffList.value;
            if (!staffSearchQuery.value) return baseList.slice(0, 10);
            const q = staffSearchQuery.value.toLowerCase().trim();
            const tokens = q.split(/\s+/).filter(Boolean);
            return baseList.filter(s => {
                const haystack = `${s.name || ''} ${s.employee_code || ''} ${s.designation || ''} ${s.allocated_to || ''}`.toLowerCase();
                return tokens.every(token => haystack.includes(token));
            }).slice(0, 15);
        });

        // Alphabetically sorted locations list from Locations sheet (filtered by allocated Country for non-admins)
        const sortedLocations = computed(() => {
            let list = locations.value;
            if (!isAdmin.value && userCountry.value && userCountry.value !== 'ALL') {
                list = list.filter(loc => (loc.country || '').trim().toUpperCase() === userCountry.value);
            }
            return [...list].sort((a, b) => (a.branch || '').localeCompare(b.branch || ''));
        });

        // Filtered locations with smart multi-word in-between substring search (e.g. typing "city" finds "Chocolala Al Saadah City Mall Salalah")
        const matchedLocations = computed(() => {
            const baseList = sortedLocations.value;
            if (!locationSearchQuery.value) return baseList;
            const q = locationSearchQuery.value.toLowerCase().trim();
            const tokens = q.split(/\s+/).filter(Boolean);
            return baseList.filter(loc => {
                const haystack = `${loc.branch || ''} ${loc.country || ''} ${loc.emr || ''} ${loc.location || ''}`.toLowerCase();
                return tokens.every(token => haystack.includes(token));
            });
        });

        // Autocomplete selections
        const selectStaffForEntry = (s) => {
            entryForm.value.staff_id = s.id || s.employee_code;
            entryForm.value.staff_name = s.name;
            entryForm.value.employee_code = s.employee_code;
            staffSearchQuery.value = `${s.name} (${s.employee_code})`;
            showStaffDropdown.value = false;

            if (s.allocated_to) {
                const exactMatch = sortedLocations.value.find(l => (l.branch || '').toLowerCase() === s.allocated_to.toLowerCase());
                if (exactMatch) {
                    entryForm.value.location = exactMatch.branch;
                    locationSearchQuery.value = exactMatch.branch;
                } else if (!entryForm.value.location && sortedLocations.value.length > 0) {
                    entryForm.value.location = sortedLocations.value[0].branch;
                    locationSearchQuery.value = sortedLocations.value[0].branch;
                }
            } else if (!entryForm.value.location && sortedLocations.value.length > 0) {
                entryForm.value.location = sortedLocations.value[0].branch;
                locationSearchQuery.value = sortedLocations.value[0].branch;
            }
        };

        const selectLocationForEntry = (loc) => {
            if (!loc) return;
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

        // Safe Time Formatter (Eliminates 1899 Base Date strings from Google Sheets)
        const formatTimeDisplay = (timeVal) => {
            if (!timeVal) return '';
            const str = String(timeVal).trim();
            if (str.includes('1899') || str.includes('GMT')) {
                const d = new Date(str);
                if (!isNaN(d.getTime())) {
                    const hh = String(d.getHours()).padStart(2, '0');
                    const mm = String(d.getMinutes()).padStart(2, '0');
                    return `${hh}:${mm}`;
                }
            }
            const match = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
            if (match) {
                return `${match[1].padStart(2, '0')}:${match[2]}`;
            }
            return str;
        };

        // Quick Log & Edit Modal State (Focused In-Place Modal Popup for Weekly Breakdown)
        const quickModal = ref({
            open: false,
            isEdit: false,
            staff_id: null,
            staff_name: '',
            employee_code: '',
            date: '',
            day_name: '',
            status: 'Present',
            location: '',
            check_in: '07:00',
            check_out: '17:00',
            total_hours: 10.0,
            notes: '',
            is_week_off_day: false
        });

        const quickModalLocationSearchQuery = ref('');
        const showQuickModalLocationDropdown = ref(false);

        const matchedQuickModalLocations = computed(() => {
            const baseList = sortedLocations.value;
            if (!quickModalLocationSearchQuery.value) return baseList;
            const q = quickModalLocationSearchQuery.value.toLowerCase().trim();
            const tokens = q.split(/\s+/).filter(Boolean);
            return baseList.filter(loc => {
                const haystack = `${loc.branch || ''} ${loc.country || ''} ${loc.emr || ''} ${loc.location || ''}`.toLowerCase();
                return tokens.every(token => haystack.includes(token));
            });
        });

        const selectLocationForQuickModal = (loc) => {
            if (!loc) return;
            quickModal.value.location = loc.branch;
            quickModalLocationSearchQuery.value = loc.branch;
            showQuickModalLocationDropdown.value = false;
        };

        const updateQuickModalHours = () => {
            const st = quickModal.value.status;
            if (st === 'WO' || st === 'OFF' || st === 'Unpaid Leave') {
                quickModal.value.total_hours = 0.0;
                return;
            }
            if (st === 'Paid Leave') {
                quickModal.value.total_hours = 8.0;
                return;
            }
            try {
                if (!quickModal.value.check_in || !quickModal.value.check_out) {
                    quickModal.value.total_hours = 10.0;
                    return;
                }
                const [inH, inM] = quickModal.value.check_in.split(':').map(Number);
                const [outH, outM] = quickModal.value.check_out.split(':').map(Number);
                let diffMin = (outH * 60 + outM) - (inH * 60 + inM);
                if (diffMin < 0) diffMin += 24 * 60; // Overnight shift
                quickModal.value.total_hours = Math.round((diffMin / 60) * 10) / 10;
            } catch (e) {
                quickModal.value.total_hours = 10.0;
            }
        };

        const openQuickLogModal = (day) => {
            if (!canDataEntry.value) {
                return showToast("Access Denied: Data entry is restricted for your role.", "error");
            }
            if (day.date > todayStr) {
                return showToast("Future dates cannot be logged.", "error");
            }
            if (!selectedStaffReport.value) return;

            const defaultLoc = entryForm.value.location || selectedStaffReport.value.display_branch || selectedStaffReport.value.allocated_to || (sortedLocations.value[0] ? sortedLocations.value[0].branch : '');
            quickModal.value = {
                open: true,
                isEdit: false,
                staff_id: selectedStaffReport.value.id || selectedStaffReport.value.employee_code,
                staff_name: selectedStaffReport.value.name,
                employee_code: selectedStaffReport.value.employee_code,
                date: day.date,
                day_name: day.day_name,
                status: 'Present',
                location: defaultLoc,
                check_in: '07:00',
                check_out: '17:00',
                total_hours: 10.0,
                notes: '',
                is_week_off_day: day.isWeekOffDay || false
            };
            quickModalLocationSearchQuery.value = defaultLoc;
            showQuickModalLocationDropdown.value = false;
        };

        const openEditLogModal = (day) => {
            if (!canDataEntry.value) {
                return showToast("Access Denied: Data entry is restricted for your role.", "error");
            }
            if (!selectedStaffReport.value) return;

            const cIn = formatTimeDisplay(day.checkIn) || (day.status === 'Present' ? '07:00' : '');
            const cOut = formatTimeDisplay(day.checkOut) || (day.status === 'Present' ? '17:00' : '');
            const loc = day.location || entryForm.value.location || selectedStaffReport.value.display_branch || selectedStaffReport.value.allocated_to || (sortedLocations.value[0] ? sortedLocations.value[0].branch : '');

            quickModal.value = {
                open: true,
                isEdit: true,
                staff_id: selectedStaffReport.value.id || selectedStaffReport.value.employee_code,
                staff_name: selectedStaffReport.value.name,
                employee_code: selectedStaffReport.value.employee_code,
                date: day.date,
                day_name: day.day_name,
                status: day.status || 'Present',
                location: loc,
                check_in: cIn,
                check_out: cOut,
                total_hours: (day.hours !== undefined && day.hours !== null) ? day.hours : (day.status === 'Present' ? 10.0 : 0.0),
                notes: day.notes || '',
                is_week_off_day: day.isWeekOffDay || false
            };
            quickModalLocationSearchQuery.value = loc;
            showQuickModalLocationDropdown.value = false;
        };

        const submitQuickModal = async () => {
            if (!quickModal.value.date) {
                return showToast("Date is required", "error");
            }
            if (!quickModal.value.location) {
                return showToast("Please select a Branch Location", "error");
            }

            loading.value = true;
            loadingText.value = quickModal.value.isEdit ? "Updating attendance record in Google Sheet..." : "Saving attendance entry to Google Sheet...";

            const payload = {
                action: 'log_attendance',
                allow_update: true,
                staff_id: quickModal.value.staff_id,
                employee_code: quickModal.value.employee_code,
                name: quickModal.value.staff_name,
                date: quickModal.value.date,
                location: quickModal.value.location,
                status: quickModal.value.status,
                check_in: quickModal.value.status === 'Present' ? quickModal.value.check_in : '',
                check_out: quickModal.value.status === 'Present' ? quickModal.value.check_out : '',
                total_hours: quickModal.value.total_hours,
                notes: quickModal.value.notes,
                user_name: currentUser.value ? currentUser.value.name : 'User',
                user_email: currentUser.value ? currentUser.value.email : ''
            };

            try {
                const resData = await apiPost(payload);

                if (resData && (resData.status === 'success' || resData.status === 'updated')) {
                    quickModal.value.open = false;
                    showToast(quickModal.value.isEdit ? "Attendance shift updated successfully!" : "Attendance logged successfully!");
                    await syncGoogleSheet(true);
                } else {
                    showToast((resData && resData.message) ? resData.message : "Error saving attendance", "error");
                }
            } catch(err) {
                console.error("Quick modal submit error:", err);
                showToast("Network error: " + (err.message || err), "error");
            } finally {
                loading.value = false;
                loadingText.value = "Processing & Syncing...";
            }
        };

        // Staff Profile Passport-Size Image Manager
        const passportModal = ref({
            open: false,
            staff: null,
            previewSrc: null,
            originalImage: null,
            scale: 1.0,
            offsetX: 0,
            offsetY: 0,
            isLandscape: false
        });

        const openPassportManager = (staff) => {
            passportModal.value = {
                open: true,
                staff: staff,
                previewSrc: (staff.image_url && !staff.image_url.includes('dicebear')) ? staff.image_url : null,
                originalImage: null,
                scale: 1.0,
                offsetX: 0,
                offsetY: 0,
                isLandscape: false
            };
        };

        const onPassportFileSelected = (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                return showToast("Please select a valid image file (JPG, PNG, WebP).", "error");
            }

            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                const img = new Image();
                img.onload = () => {
                    passportModal.value.originalImage = img;
                    passportModal.value.previewSrc = loadEvent.target.result;
                    passportModal.value.scale = 1.0;
                    passportModal.value.offsetX = 0;
                    passportModal.value.offsetY = 0;
                    passportModal.value.isLandscape = (img.width > img.height);
                };
                img.src = loadEvent.target.result;
            };
            reader.readAsDataURL(file);
        };

        const savePassportPhoto = async () => {
            const p = passportModal.value;
            if (!p.staff) return;
            if (!p.originalImage && !p.previewSrc) {
                return showToast("Please select a photo first.", "error");
            }

            loading.value = true;
            loadingText.value = "Processing and saving passport-size photo...";

            try {
                // Standard passport dimensions: 350x450 px (35mm x 45mm, 7:9 ratio)
                const canvas = document.createElement('canvas');
                canvas.width = 350;
                canvas.height = 450;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, 350, 450);

                if (p.originalImage) {
                    const img = p.originalImage;
                    const targetRatio = 350 / 450;
                    const imgRatio = img.width / img.height;

                    let drawW, drawH;
                    if (imgRatio > targetRatio) {
                        drawH = 450 * p.scale;
                        drawW = drawH * imgRatio;
                    } else {
                        drawW = 350 * p.scale;
                        drawH = drawW / imgRatio;
                    }

                    const centerX = (350 - drawW) / 2 + p.offsetX;
                    const centerY = (450 - drawH) / 2 + p.offsetY;

                    ctx.drawImage(img, centerX, centerY, drawW, drawH);
                } else {
                    const tempImg = new Image();
                    tempImg.crossOrigin = "anonymous";
                    await new Promise((resolve) => {
                        tempImg.onload = resolve;
                        tempImg.onerror = resolve;
                        tempImg.src = p.previewSrc;
                    });
                    ctx.drawImage(tempImg, 0, 0, 350, 450);
                }

                // Compress to web-friendly JPEG data URL
                const base64Data = canvas.toDataURL('image/jpeg', 0.75);

                const payloadData = {
                    ...p.staff,
                    image_url: base64Data
                };

                const ok = await sendAdminCrud('Staff_data', 'edit', p.staff.row_index, payloadData);
                if (ok) {
                    p.staff.image_url = base64Data;
                    p.staff.has_custom_image = true;
                    showToast(`Passport photo updated for ${p.staff.name}!`);
                    passportModal.value.open = false;
                }
            } catch (err) {
                console.error("Passport photo save error:", err);
                showToast("Failed to process photo: " + (err.message || err), "error");
            } finally {
                loading.value = false;
                loadingText.value = "Processing & Syncing...";
            }
        };

        // -------------------------------------------------------------
        // Adaptive normalizers to handle both new Apps Script v4.1 and legacy/shifted v4.0 responses
        const normalizeUserItem = (u) => {
            if (!u) return u;
            let r = (u.role || '').toString().trim();
            let c = (u.country || '').toString().trim().toUpperCase();
            const up = (u.updated_by_user || '').toString().trim();
            const rNorm = r.toLowerCase().replace(/[\s\-_]/g, '');
            const upNorm = up.toLowerCase().replace(/[\s\-_]/g, '');

            // Detect shifted columns from older Apps Script (Country inserted at col 2, pushing Role to updated_by_user):
            if (upNorm === 'admin') {
                r = 'Admin';
                if (!c || c === 'DATA_ENTRY') c = (rNorm === 'oman' ? 'OMAN' : 'UAE');
            } else if (upNorm === 'reportonly' || upNorm === 'report' || upNorm === 'reports') {
                r = 'Report_Only';
                if (!c || c === 'DATA_ENTRY') c = (rNorm === 'oman' ? 'OMAN' : 'UAE');
            } else if (upNorm === 'dataentry') {
                r = 'Data_Entry';
                if (!c || c === 'DATA_ENTRY') c = (rNorm === 'oman' ? 'OMAN' : 'UAE');
            } else if (rNorm === 'admin') {
                r = 'Admin';
            } else if (rNorm === 'reportonly' || rNorm === 'report' || rNorm === 'reports') {
                r = 'Report_Only';
            } else {
                r = 'Data_Entry';
            }

            // Explicit Admin check for Shuhaib
            const gm = (u.gmail || '').toLowerCase().trim();
            if (gm === 'shuhaibonly@gmail.com' || gm === 'inventory.choco@gmail.com') {
                r = 'Admin';
            }

            return {
                ...u,
                role: r,
                country: c || 'UAE'
            };
        };

        const normalizeLocItem = (l) => {
            if (!l) return l;
            let branch = (l.branch || '').toString().trim();
            let country = (l.country || '').toString().trim().toUpperCase();
            let emr = (l.emr || '').toString().trim();
            let location = (l.location || '').toString().trim();
            const up = (l.updated_by_user || '').toString().trim();

            const emrUp = emr.toUpperCase();
            // Detect shifted columns from older Apps Script (Country inserted at col 1, pushing EMR to location and location to updated_by_user):
            if (emrUp === 'OM' || emrUp === 'OMAN') {
                country = 'OMAN';
                emr = (location && location !== 'OM') ? location : 'OM';
                location = up || 'Oman';
            } else if (emrUp === 'UAE') {
                country = 'UAE';
                emr = location;
                location = up || location;
            } else if (emrUp === 'KSA' || emrUp === 'SA') {
                country = 'KSA';
                emr = location;
                location = up || location;
            } else if (country === 'OM' || country === 'OMAN') {
                country = 'OMAN';
            } else if (country === 'UAE') {
                country = 'UAE';
            } else if (!country) {
                // Heuristic check if branch or location mentions Oman locations
                const bLower = (branch + ' ' + location + ' ' + emr).toLowerCase();
                if (bLower.includes('oman') || bLower.includes('barka') || bLower.includes('salalah') || bLower.includes('amirat') || bLower.includes('sohar') || bLower.includes('nizwa') || bLower.includes('muscat')) {
                    country = 'OMAN';
                } else {
                    country = 'UAE';
                }
            }

            return {
                ...l,
                branch,
                country: country || 'UAE',
                emr,
                location
            };
        };

        // LIVE GOOGLE SHEET DATA SYNC
        // -------------------------------------------------------------
        const syncGoogleSheet = async (isBackground = false) => {
            const url = googleSheetWebAppUrl.value.trim();
            if (!url) return;

            if (!isBackground) loading.value = true;
            sheetConnectionStatus.value = 'connecting';

            try {
                const data = await apiGet('get_all');

                if (data.status === 'success') {
                    if (data.staff && Array.isArray(data.staff)) {
                        staffList.value = data.staff;
                    }
                    if (data.locations && Array.isArray(data.locations)) {
                        locations.value = data.locations.map(normalizeLocItem);
                        if (!entryForm.value.location && locations.value.length > 0) {
                            entryForm.value.location = locations.value[0].branch;
                            locationSearchQuery.value = locations.value[0].branch;
                        }
                    }
                    if (data.attendance && Array.isArray(data.attendance)) {
                        attendanceLogs.value = data.attendance;
                    }
                    if (data.users && Array.isArray(data.users)) {
                        usersList.value = data.users.map(normalizeUserItem);
                        if (currentUser.value && currentUser.value.email) {
                            const uMatch = usersList.value.find(u => u.gmail && u.gmail.toLowerCase().trim() === currentUser.value.email.toLowerCase().trim());
                            if (uMatch) {
                                currentUser.value.role = uMatch.role;
                                currentUser.value.country = uMatch.country;
                                currentUser.value.userName = uMatch.user_name || currentUser.value.userName;
                                saveUserSession(currentUser.value);
                            }
                        }
                    }
                    if (data.allocations && Array.isArray(data.allocations)) {
                        allocationsList.value = data.allocations;
                    }
                    if (data.schedules && Array.isArray(data.schedules)) {
                        schedulesList.value = data.schedules;
                    }
                    if (data.branch_reports && Array.isArray(data.branch_reports)) {
                        branchReportsList.value = data.branch_reports;
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
            if (!entryForm.value.location) {
                showToast("Please select a Branch Location", "error");
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

                const data = await apiPost(payload);

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
                            checkIn = formatTimeDisplay(log.check_in);
                            checkOut = formatTimeDisplay(log.check_out);
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
                            hasLog: !!log,
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

                // Collect unique branches where the staff actually logged attendance during this cycle
                const loggedBranchesSet = new Set();
                weeklyBreakdown.forEach(w => {
                    (w.days || []).forEach(d => {
                        if (d.status === 'Present' && d.location && d.location.trim()) {
                            loggedBranchesSet.add(d.location.trim());
                        }
                    });
                });
                const loggedBranchesArr = Array.from(loggedBranchesSet);
                const displayBranch = loggedBranchesArr.length > 0 ? loggedBranchesArr.join(', ') : staff.allocated_to;

                return {
                    id: staff.id,
                    sl_no: staff.sl_no,
                    employee_code: staff.employee_code,
                    name: staff.name,
                    designation: staff.designation,
                    allocated_to: staff.allocated_to,
                    display_branch: displayBranch,
                    logged_branches: loggedBranchesArr.join(', '),
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
                    const tokens = searchQuery.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
                    const haystack = `${s.name || ''} ${s.employee_code || ''} ${s.allocated_to || ''} ${s.designation || ''}`.toLowerCase();
                    if (!tokens.every(token => haystack.includes(token))) return false;
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
                    s.display_branch || s.allocated_to,
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
                            d.location || s.display_branch || s.allocated_to,
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

        // Avatar fallback generator
        const getDiceBearUrl = (name) => {
            return "https://api.dicebear.com/7.x/initials/svg?seed=" + encodeURIComponent(name || 'Staff') + "&backgroundColor=0284c7,0d9488,4f46e5&textColor=ffffff";
        };

        // Quota-safe session persistence (prevents localStorage QuotaExceededError and browser crashes)
        const saveUserSession = (user) => {
            if (!user) {
                try { localStorage.removeItem('attendance_auth_user'); } catch(e){}
                return;
            }
            try {
                const cleanUser = {
                    name: user.name,
                    userName: user.userName,
                    email: user.email,
                    role: user.role,
                    country: user.country,
                    picture: (user.picture && !user.picture.startsWith('data:')) ? user.picture : null,
                    exp: user.exp
                };
                localStorage.setItem('attendance_auth_user', JSON.stringify(cleanUser));
            } catch (err) {
                console.warn("[saveUserSession] Quota exceeded or storage error:", err);
            }
        };

        const openWhatsApp = (num) => {
            if (!num) return showToast("No WhatsApp number registered", "error");
            window.open(`https://wa.me/${num.replace(/\D/g, '')}`, '_blank');
        };

        // -------------------------------------------------------------
        // BRANCH VISIT SCHEDULE MODULE (Multi-Staff Allocation & Conflict Prevention)
        // -------------------------------------------------------------
        const scheduleForm = ref({
            branch: '',
            location: '',
            visit_start_date: todayStr,
            visit_start_time: '09:00',
            visit_end_date: todayStr,
            visit_end_time: '18:00',
            allocated_staff_list: [], // Array of employee_codes: ['1742', '3934']
            allocated_to_staff: '',
            row_index: null,
            is_editing: false
        });

        // Search within staff selector for branch scheduling
        const scheduleStaffSearchQuery = ref('');

        const matchedScheduleStaffList = computed(() => {
            const list = visibleStaffList.value;
            if (!scheduleStaffSearchQuery.value) return list;
            const q = scheduleStaffSearchQuery.value.toLowerCase().trim();
            const tokens = q.split(/\s+/).filter(Boolean);
            return list.filter(s => {
                const haystack = `${s.name || ''} ${s.employee_code || ''} ${s.designation || ''}`.toLowerCase();
                return tokens.every(t => haystack.includes(t));
            });
        });

        const isStaffSelectedInSchedule = (staff) => {
            if (!staff || !staff.employee_code) return false;
            return scheduleForm.value.allocated_staff_list.includes(String(staff.employee_code).trim());
        };

        const toggleStaffInSchedule = (staff) => {
            if (!staff || !staff.employee_code) return;
            const code = String(staff.employee_code).trim();
            const idx = scheduleForm.value.allocated_staff_list.indexOf(code);
            if (idx > -1) {
                scheduleForm.value.allocated_staff_list.splice(idx, 1);
            } else {
                scheduleForm.value.allocated_staff_list.push(code);
            }
        };

        const selectAllStaffInSchedule = () => {
            const allCodes = visibleStaffList.value.map(s => String(s.employee_code).trim()).filter(Boolean);
            scheduleForm.value.allocated_staff_list = Array.from(new Set(allCodes));
        };

        const clearAllStaffInSchedule = () => {
            scheduleForm.value.allocated_staff_list = [];
        };

        // Smart Search Autocomplete for Schedule Branch (identical to Log Attendance)
        const scheduleLocationSearchQuery = ref('');
        const showScheduleLocationDropdown = ref(false);

        // Filtered locations with multi-token substring search
        const matchedScheduleLocations = computed(() => {
            const baseList = sortedLocations.value;
            if (!scheduleLocationSearchQuery.value) return baseList;
            const q = scheduleLocationSearchQuery.value.toLowerCase().trim();
            const tokens = q.split(/\s+/).filter(Boolean);
            return baseList.filter(loc => {
                const haystack = `${loc.branch || ''} ${loc.country || ''} ${loc.emr || ''} ${loc.location || ''}`.toLowerCase();
                return tokens.every(token => haystack.includes(token));
            });
        });

        const selectLocationForSchedule = (loc) => {
            if (!loc) return;
            scheduleForm.value.branch = loc.branch;
            scheduleForm.value.location = loc.location || loc.emr || '';
            scheduleLocationSearchQuery.value = loc.branch;
            showScheduleLocationDropdown.value = false;
        };

        // Automatically calculate +9 hours from start date & time (handles midnight/day rollover)
        const updateScheduleEndTime = () => {
            if (!scheduleForm.value.visit_start_date) return;
            const timeStr = scheduleForm.value.visit_start_time || '09:00';
            try {
                const [year, month, day] = scheduleForm.value.visit_start_date.split('-').map(Number);
                const [hours, minutes] = timeStr.split(':').map(Number);
                const startDt = new Date(year, month - 1, day, hours, minutes, 0);
                const endDt = new Date(startDt.getTime() + 9 * 60 * 60 * 1000);

                const endYear = endDt.getFullYear();
                const endMonth = String(endDt.getMonth() + 1).padStart(2, '0');
                const endDay = String(endDt.getDate()).padStart(2, '0');
                const endHours = String(endDt.getHours()).padStart(2, '0');
                const endMinutes = String(endDt.getMinutes()).padStart(2, '0');

                scheduleForm.value.visit_end_date = `${endYear}-${endMonth}-${endDay}`;
                scheduleForm.value.visit_end_time = `${endHours}:${endMinutes}`;
            } catch (err) {
                console.error("Error auto-calculating 9h schedule end:", err);
            }
        };

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
            const allowedStaffCodes = new Set(visibleStaffList.value.map(s => String(s.employee_code).trim()));
            const isUnrestricted = isAdmin.value || userRole.value === 'Report_Only';

            return schedulesList.value.filter(sc => {
                // For non-admin, non-report users: only show schedules allocating their visible staff
                if (!isUnrestricted) {
                    const scStaff = sc.allocated_to_staff || '';
                    const hasMyStaff = Array.from(allowedStaffCodes).some(code =>
                        scStaff.includes(`(${code})`) || scStaff.includes(code)
                    );
                    if (!hasMyStaff) return false;
                }

                if (scheduleFilterBranch.value !== 'ALL' && sc.branch !== scheduleFilterBranch.value) return false;
                if (scheduleFilterStaff.value !== 'ALL' && !String(sc.allocated_to_staff || '').includes(scheduleFilterStaff.value)) return false;
                if (scheduleSearchQuery.value) {
                    const tokens = scheduleSearchQuery.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
                    const haystack = `${sc.branch || ''} ${sc.location || ''} ${sc.allocated_to_staff || ''} ${sc.visit_start_date || sc.visit_date || ''} ${sc.visit_end_date || ''} ${sc.updated_by_user || ''}`.toLowerCase();
                    if (!tokens.every(token => haystack.includes(token))) return false;
                }
                return true;
            }).sort((a, b) => (b.visit_start_date || b.visit_date || '').localeCompare(a.visit_start_date || a.visit_date || ''));
        });

        const saveSchedule = async () => {
            if (!scheduleForm.value.branch) {
                return showToast("Please select a Branch Location", "error");
            }
            if (!scheduleForm.value.visit_start_date) {
                return showToast("Please select a Visit Start Date", "error");
            }
            if (!scheduleForm.value.allocated_staff_list || scheduleForm.value.allocated_staff_list.length === 0) {
                return showToast("Please select at least one Staff Member to allocate", "error");
            }

            const startTime = scheduleForm.value.visit_start_time || '09:00';
            const endTime = scheduleForm.value.visit_end_time || '18:00';
            const startDate = scheduleForm.value.visit_start_date;
            const endDate = scheduleForm.value.visit_end_date || startDate;

            // Conflict Detection: A staff cannot be allocated to multiple branches on overlapping dates & times
            const newStartMs = new Date(`${startDate} ${startTime}`.replace(/-/g, '/')).getTime();
            const newEndMs = new Date(`${endDate} ${endTime}`.replace(/-/g, '/')).getTime();

            for (const empCode of scheduleForm.value.allocated_staff_list) {
                const staffObj = staffList.value.find(s => String(s.employee_code).trim() === empCode);
                const staffLabel = staffObj ? `${staffObj.name} (${empCode})` : `Staff #${empCode}`;

                for (const existing of schedulesList.value) {
                    // Skip the row currently being edited
                    if (scheduleForm.value.is_editing && String(existing.row_index) === String(scheduleForm.value.row_index)) {
                        continue;
                    }

                    const exStaffStr = existing.allocated_to_staff || '';
                    const isAllocated = exStaffStr.includes(`(${empCode})`) ||
                                        exStaffStr.includes(empCode) ||
                                        (staffObj && exStaffStr.toLowerCase().includes(staffObj.name.toLowerCase()));

                    if (isAllocated && existing.branch !== scheduleForm.value.branch) {
                        const exStartDate = existing.visit_start_date || existing.visit_date;
                        const exStartTime = formatTimeDisplay(existing.visit_start_time || existing.visit_time) || '09:00';
                        const exEndDate = existing.visit_end_date || exStartDate;
                        const exEndTime = formatTimeDisplay(existing.visit_end_time) || '18:00';

                        const exStartMs = new Date(`${exStartDate} ${exStartTime}`.replace(/-/g, '/')).getTime();
                        const exEndMs = new Date(`${exEndDate} ${exEndTime}`.replace(/-/g, '/')).getTime();

                        // Time overlap check: (newStart < exEnd) && (newEnd > exStart)
                        if (newStartMs < exEndMs && newEndMs > exStartMs) {
                            return showToast(`Conflict: ${staffLabel} is already allocated to visit "${existing.branch}" on ${exStartDate} (${exStartTime} – ${exEndTime}). One staff cannot be scheduled to multiple branches in the same time period!`, "error");
                        }
                    }
                }
            }

            // Build readable comma-separated staff allocation string
            const staffLabels = scheduleForm.value.allocated_staff_list.map(code => {
                const s = staffList.value.find(x => String(x.employee_code).trim() === code);
                return s ? `${s.name} (${s.employee_code})` : code;
            });
            const allocatedStr = staffLabels.join(', ');

            loading.value = true;
            loadingText.value = scheduleForm.value.is_editing ? "Updating branch visit schedule in Google Sheet..." : "Adding branch visit schedule to Google Sheet...";

            const op = scheduleForm.value.is_editing ? 'edit' : 'add';
            const payloadData = {
                branch: scheduleForm.value.branch,
                location: scheduleForm.value.location,
                visit_start_date: startDate,
                visit_start_time: startTime,
                visit_end_date: endDate,
                visit_end_time: endTime,
                visit_date: startDate,
                visit_time: startTime,
                allocated_to_staff: allocatedStr
            };

            const success = await sendAdminCrud('Schedule', op, scheduleForm.value.row_index, payloadData);
            if (success) {
                scheduleForm.value.branch = '';
                scheduleLocationSearchQuery.value = '';
                scheduleForm.value.location = '';
                scheduleForm.value.visit_start_date = todayStr;
                scheduleForm.value.visit_start_time = '09:00';
                scheduleForm.value.visit_end_date = todayStr;
                scheduleForm.value.visit_end_time = '18:00';
                scheduleForm.value.allocated_staff_list = [];
                scheduleForm.value.allocated_to_staff = '';
                scheduleForm.value.is_editing = false;
                scheduleForm.value.row_index = null;
                showScheduleLocationDropdown.value = false;
            }
        };

        const editSchedule = (sc) => {
            scheduleForm.value.branch = sc.branch || '';
            scheduleLocationSearchQuery.value = sc.branch || '';
            scheduleForm.value.location = sc.location || '';
            scheduleForm.value.visit_start_date = sc.visit_start_date || sc.visit_date || todayStr;
            scheduleForm.value.visit_start_time = formatTimeDisplay(sc.visit_start_time || sc.visit_time) || '09:00';
            scheduleForm.value.visit_end_date = sc.visit_end_date || scheduleForm.value.visit_start_date;
            scheduleForm.value.visit_end_time = formatTimeDisplay(sc.visit_end_time) || '18:00';
            scheduleForm.value.row_index = sc.row_index;
            scheduleForm.value.is_editing = true;
            showScheduleLocationDropdown.value = false;

            // Parse allocated staff
            const staffStr = sc.allocated_to_staff || '';
            const selectedCodes = [];
            visibleStaffList.value.forEach(s => {
                const code = String(s.employee_code).trim();
                if (staffStr.includes(`(${code})`) || staffStr.includes(code) || staffStr.toLowerCase().includes(s.name.toLowerCase())) {
                    selectedCodes.push(code);
                }
            });
            scheduleForm.value.allocated_staff_list = selectedCodes;

            const el = document.getElementById('schedule-form-card');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            showToast(`Editing visit to ${sc.branch}. Update details and click "Update Visit Schedule".`, "info");
        };

        const deleteSchedule = async (sc) => {
            const vDate = sc.visit_start_date || sc.visit_date || '';
            if (!confirm(`Delete visit schedule to ${sc.branch} on ${vDate}?`)) return;
            await sendAdminCrud('Schedule', 'delete', sc.row_index, {});
        };

        const cancelScheduleEdit = () => {
            scheduleForm.value.branch = '';
            scheduleLocationSearchQuery.value = '';
            scheduleForm.value.location = '';
            scheduleForm.value.visit_start_date = todayStr;
            scheduleForm.value.visit_start_time = '09:00';
            scheduleForm.value.visit_end_date = todayStr;
            scheduleForm.value.visit_end_time = '18:00';
            scheduleForm.value.allocated_staff_list = [];
            scheduleForm.value.allocated_to_staff = '';
            scheduleForm.value.is_editing = false;
            scheduleForm.value.row_index = null;
            showScheduleLocationDropdown.value = false;
        };

        const exportScheduleExcel = () => {
            if (typeof XLSX === 'undefined') {
                return showToast("Loading Excel exporter...", "info");
            }
            const rows = [
                ["BRANCH VISIT SCHEDULES"],
                [`Exported On: ${new Date().toLocaleString()}`],
                [],
                ["Sl", "Branch", "Location", "Visit Start Date", "Visit Start Time", "Visit End Date", "Visit End Time", "Allocated to Staff", "Updated By User", "Updated By Date"]
            ];

            filteredSchedules.value.forEach((sc, idx) => {
                rows.push([
                    idx + 1,
                    sc.branch,
                    sc.location,
                    sc.visit_start_date || sc.visit_date || '',
                    sc.visit_start_time || sc.visit_time || '',
                    sc.visit_end_date || sc.visit_start_date || sc.visit_date || '',
                    sc.visit_end_time || '',
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
        // BRANCH REPORTS MODULE (Google Sheet Report Links)
        // -------------------------------------------------------------
        const branchReportsList = ref([]);
        const reportForm = ref({
            date: todayStr,
            branch_name: '',
            sheet_link: '',
            sheet_name: '',
            is_editing: false,
            row_index: null
        });
        const isFetchingSheetTitle = ref(false);
        const reportSearchQuery = ref('');
        const reportBranchSearchQuery = ref('');
        const showReportBranchDropdown = ref(false);

        const matchedReportBranches = computed(() => {
            const q = reportBranchSearchQuery.value.toLowerCase().trim();
            const list = sortedLocations.value;
            if (!q) return list;
            return list.filter(loc => {
                const b = (loc.branch || '').toLowerCase();
                const l = (loc.location || '').toLowerCase();
                const c = (loc.country || '').toLowerCase();
                const e = (loc.emr || '').toLowerCase();
                return b.includes(q) || l.includes(q) || c.includes(q) || e.includes(q);
            });
        });

        const selectReportBranch = (loc) => {
            reportForm.value.branch_name = loc.branch;
            reportBranchSearchQuery.value = loc.branch;
            showReportBranchDropdown.value = false;
        };

        const autoFetchSheetName = async (overrideUrl) => {
            const rawUrl = overrideUrl !== undefined ? overrideUrl : reportForm.value.sheet_link;
            const url = (rawUrl || '').trim();
            if (!url) return;
            const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || url.match(/id=([a-zA-Z0-9-_]+)/) || url.match(/^([a-zA-Z0-9-_]{25,})$/);
            if (!idMatch) return;

            isFetchingSheetTitle.value = true;
            try {
                const data = await apiGet('fetch_sheet_name', { url: url });
                if (data && data.status === 'success' && data.sheet_name) {
                    reportForm.value.sheet_name = data.sheet_name;
                    showToast(`Detected sheet: "${data.sheet_name}"`, "info");

                    // If branch is not yet selected, attempt to match from title
                    if (!reportForm.value.branch_name) {
                        const lowerTitle = data.sheet_name.toLowerCase();
                        const foundLoc = sortedLocations.value.find(loc => {
                            if (!loc.branch) return false;
                            const bLower = loc.branch.toLowerCase().trim();
                            return lowerTitle.includes(bLower) || bLower.includes(lowerTitle);
                        });
                        if (foundLoc) {
                            reportForm.value.branch_name = foundLoc.branch;
                            reportBranchSearchQuery.value = foundLoc.branch;
                        }
                    }
                } else if (data && data.status === 'error') {
                    showToast(`Fetch notice: ${data.message || 'Could not auto-detect title'}`, "warning");
                }
            } catch (err) {
                console.warn("Could not auto-fetch sheet title:", err);
            } finally {
                isFetchingSheetTitle.value = false;
            }
        };

        const onReportLinkPaste = (event) => {
            const clipboardData = event.clipboardData || window.clipboardData;
            const pastedText = clipboardData ? clipboardData.getData('text') : '';
            if (pastedText) {
                reportForm.value.sheet_link = pastedText.trim();
                setTimeout(() => autoFetchSheetName(pastedText.trim()), 50);
            }
        };

        const handleReportLinkBlur = () => {
            if (reportForm.value.sheet_link && !reportForm.value.sheet_name) {
                autoFetchSheetName();
            }
        };

        const saveBranchReport = async () => {
            if (!reportForm.value.branch_name) {
                return showToast("Please select a Branch for this report.", "warning");
            }
            if (!reportForm.value.sheet_link) {
                return showToast("Please paste the Google Sheet Link.", "warning");
            }

            const op = reportForm.value.is_editing ? 'edit' : 'add';
            const payloadData = {
                report_date: reportForm.value.date || todayStr,
                branch_name: reportForm.value.branch_name,
                sheet_link: reportForm.value.sheet_link.trim(),
                sheet_name: reportForm.value.sheet_name.trim() || `Branch Report (${reportForm.value.branch_name})`
            };

            const success = await sendAdminCrud('Branch_Reports', op, reportForm.value.row_index, payloadData);
            if (success) {
                showToast(reportForm.value.is_editing ? "Branch Report updated successfully!" : "Branch Report added successfully!");
                reportForm.value = {
                    date: todayStr,
                    branch_name: '',
                    sheet_link: '',
                    sheet_name: '',
                    is_editing: false,
                    row_index: null
                };
                reportBranchSearchQuery.value = '';
                showReportBranchDropdown.value = false;
                await fetchData();
            }
        };

        const editBranchReport = (rep) => {
            reportForm.value.date = rep.report_date || todayStr;
            reportForm.value.branch_name = rep.branch_name || '';
            reportBranchSearchQuery.value = rep.branch_name || '';
            reportForm.value.sheet_link = rep.sheet_link || '';
            reportForm.value.sheet_name = rep.sheet_name || '';
            reportForm.value.row_index = rep.row_index;
            reportForm.value.is_editing = true;
            showReportBranchDropdown.value = false;

            const el = document.getElementById('report-form-card');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            showToast(`Editing report for ${rep.branch_name}.`, "info");
        };

        const cancelReportEdit = () => {
            reportForm.value = {
                date: todayStr,
                branch_name: '',
                sheet_link: '',
                sheet_name: '',
                is_editing: false,
                row_index: null
            };
            reportBranchSearchQuery.value = '';
            showReportBranchDropdown.value = false;
        };

        const deleteBranchReport = async (rep) => {
            if (!confirm(`Are you sure you want to delete the report for "${rep.branch_name}" (${rep.report_date})?`)) {
                return;
            }
            const success = await sendAdminCrud('Branch_Reports', 'delete', rep.row_index, {});
            if (success) {
                showToast("Branch Report deleted.");
                await fetchData();
            }
        };

        const filteredBranchReports = computed(() => {
            let list = branchReportsList.value || [];
            
            const isUnrestricted = isAdmin.value || userRole.value === 'Report_Only' || userCountry.value === 'ALL';
            if (!isUnrestricted && userCountry.value) {
                const targetCountry = userCountry.value.toUpperCase().trim();
                list = list.filter(rep => {
                    const matchedLoc = sortedLocations.value.find(l => 
                        (l.branch || '').toLowerCase() === (rep.branch_name || '').toLowerCase()
                    );
                    if (!matchedLoc) return true;
                    const c = (matchedLoc.country || '').toUpperCase().trim();
                    return c === targetCountry || (targetCountry === 'OMAN' && c === 'OM');
                });
            }

            const q = reportSearchQuery.value.toLowerCase().trim();
            if (!q) return list;

            return list.filter(rep => {
                const b = (rep.branch_name || '').toLowerCase();
                const n = (rep.sheet_name || '').toLowerCase();
                const d = (rep.report_date || '').toLowerCase();
                const u = (rep.updated_by_user || '').toLowerCase();
                return b.includes(q) || n.includes(q) || d.includes(q) || u.includes(q);
            });
        });

        const exportBranchReportsExcel = () => {
            if (typeof XLSX === 'undefined') {
                return showToast("Loading Excel exporter...", "info");
            }
            const rows = [
                ["BRANCH REPORTS"],
                [`Exported On: ${new Date().toLocaleString()}`],
                [],
                ["Sl", "Date", "Branch Name", "Google Sheet Name", "Google Sheet Link", "Updated By User", "Updated By Date"]
            ];

            filteredBranchReports.value.forEach((rep, idx) => {
                rows.push([
                    idx + 1,
                    rep.report_date,
                    rep.branch_name,
                    rep.sheet_name,
                    rep.sheet_link,
                    rep.updated_by_user,
                    rep.updated_by_date
                ]);
            });

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Branch Reports");
            XLSX.writeFile(wb, `Branch_Reports_${todayStr}.xlsx`);
            showToast("Downloaded Branch Reports Excel!");
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
            form: { user_name: '', gmail: '', country: 'UAE', role: 'Data_Entry' }
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
            form: { branch: '', country: 'UAE', emr: '', location: '' }
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
                const resData = await apiPost(payload);

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
                form: { user_name: '', gmail: '', country: 'UAE', role: 'Data_Entry' }
            };
        };

        const openEditUserModal = (u) => {
            userModal.value = {
                open: true,
                isEdit: true,
                rowIndex: u.row_index,
                form: { user_name: u.user_name, gmail: u.gmail, country: u.country || 'UAE', role: u.role }
            };
        };

        const saveUserModal = async () => {
            if (!userModal.value.form.gmail) {
                return showToast("Gmail address is required", "error");
            }
            const op = userModal.value.isEdit ? 'edit' : 'add';
            loadingText.value = userModal.value.isEdit ? "Updating user access & role in Google Sheet..." : "Granting user access in Google Sheet...";
            const payload = {
                user_name: userModal.value.form.user_name || '',
                gmail: (userModal.value.form.gmail || '').toLowerCase().trim(),
                country: (userModal.value.form.country || 'UAE').toUpperCase().trim(),
                role: userModal.value.form.role || 'Data_Entry'
            };
            const ok = await sendAdminCrud('Users_Data', op, userModal.value.rowIndex, payload);
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
                form: { branch: '', country: 'UAE', emr: 'DXB', location: 'Dubai' }
            };
        };

        const openEditLocModal = (l) => {
            locModal.value = {
                open: true,
                isEdit: true,
                rowIndex: l.row_index,
                form: { branch: l.branch, country: l.country || 'UAE', emr: l.emr, location: l.location }
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

                const data = await apiGet('get_all');

                if (!data || data.status !== 'success') {
                    authError.value = 'Could not load data from Google Sheet. Please try again.';
                    isAuthChecking.value = false;
                    return;
                }

                if (data.staff && Array.isArray(data.staff)) staffList.value = data.staff;
                if (data.locations && Array.isArray(data.locations)) locations.value = data.locations.map(normalizeLocItem);
                if (data.attendance && Array.isArray(data.attendance)) attendanceLogs.value = data.attendance;
                if (data.users && Array.isArray(data.users)) usersList.value = data.users.map(normalizeUserItem);
                if (data.allocations && Array.isArray(data.allocations)) allocationsList.value = data.allocations;
                if (data.schedules && Array.isArray(data.schedules)) schedulesList.value = data.schedules;
                if (data.branch_reports && Array.isArray(data.branch_reports)) branchReportsList.value = data.branch_reports;
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
                        country: (matchedUser.country || 'UAE').toUpperCase().trim(),
                        staff: matchedStaff || null,
                        exp: tokenExp
                    };

                    saveUserSession(currentUser.value);
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
                authError.value = `Authentication failed: ${err.message || 'Could not connect to Google Sheet. Check connection.'}`;
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

                const em = (userData.email || '').toLowerCase().trim();
                if (em === 'shuhaibonly@gmail.com') {
                    userData.role = userData.role || 'Admin';
                    userData.country = userData.country || 'ALL';
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

                try {
                    const data = await apiGet('get_all');

                    if (data && data.status === 'success') {
                        if (data.staff && Array.isArray(data.staff)) staffList.value = data.staff;
                        if (data.locations && Array.isArray(data.locations)) locations.value = data.locations.map(normalizeLocItem);
                        if (data.attendance && Array.isArray(data.attendance)) attendanceLogs.value = data.attendance;
                        if (data.users && Array.isArray(data.users)) usersList.value = data.users.map(normalizeUserItem);
                        if (data.allocations && Array.isArray(data.allocations)) allocationsList.value = data.allocations;
                        if (data.schedules && Array.isArray(data.schedules)) schedulesList.value = data.schedules;
                        if (data.branch_reports && Array.isArray(data.branch_reports)) branchReportsList.value = data.branch_reports;
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
                            currentUser.value.country = (matchedUser.country || 'UAE').toUpperCase().trim();
                            currentUser.value.staff = matchedStaff || userData.staff || null;

                            saveUserSession(currentUser.value);
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
                    }
                } catch (netErr) {
                    console.warn("Could not refresh session from sheet on boot, keeping cached session:", netErr);
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
            branchReportsList.value = [];
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
            loadingText,
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
            updateEntryHours,
            submitAttendanceEntry,
            syncGoogleSheet,
            onCycleChange,
            exportExcel,
            printReport,
            openWhatsApp,
            userCountry,
            showLocationDropdown,
            selectLocationForEntry,
            // Quick-Log & Edit Modal
            quickModal,
            quickModalLocationSearchQuery,
            showQuickModalLocationDropdown,
            matchedQuickModalLocations,
            selectLocationForQuickModal,
            updateQuickModalHours,
            openQuickLogModal,
            openEditLogModal,
            submitQuickModal,
            formatTimeDisplay,
            // Passport Photo Manager
            passportModal,
            openPassportManager,
            onPassportFileSelected,
            savePassportPhoto,
            // Schedule Module
            scheduleForm,
            scheduleStaffSearchQuery,
            matchedScheduleStaffList,
            isStaffSelectedInSchedule,
            toggleStaffInSchedule,
            selectAllStaffInSchedule,
            clearAllStaffInSchedule,
            scheduleLocationSearchQuery,
            showScheduleLocationDropdown,
            matchedScheduleLocations,
            selectLocationForSchedule,
            updateScheduleEndTime,
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
            getDiceBearUrl,
            // Branch Reports Module
            branchReportsList,
            reportForm,
            isFetchingSheetTitle,
            reportSearchQuery,
            reportBranchSearchQuery,
            showReportBranchDropdown,
            matchedReportBranches,
            selectReportBranch,
            autoFetchSheetName,
            onReportLinkPaste,
            handleReportLinkBlur,
            saveBranchReport,
            editBranchReport,
            cancelReportEdit,
            deleteBranchReport,
            filteredBranchReports,
            exportBranchReportsExcel,
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
