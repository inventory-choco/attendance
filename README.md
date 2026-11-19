# Staff Attendance Management System

A high-performance, mobile-first, and privacy-preserving Staff Attendance & Overtime/Undertime Tracking Web Application designed specifically for multi-branch staff with flexible daily schedules.

- **GitHub Pages Live App:** [https://inventory-choco.github.io/attendance/](https://inventory-choco.github.io/attendance/)
- **GitHub Repository:** [https://github.com/inventory-choco/attendance.git](https://github.com/inventory-choco/attendance.git)
- **Backend Storage:** 100% Private Google Sheets via Google Apps Script Web App

---

## 🌟 Core Business Rules & Features

### 1. Flexible Shift Scheduling (48 Hours / Week)
- Staff work varied shifts across different times of the day (e.g., 6 hours one day, 12 hours another day, 8h, 10h).
- Daily schedule is completely flexible as long as they complete **48 Hours in a week**.

### 2. Automatic Week Offs ("WO") on Fridays & Sundays
- **Rule:** Normally every **Sunday** and **Friday** is treated as **"WO" (Week Off)**.
- If staff did not log a shift for these days, they automatically calculate as **"WO"** with 0 hours required.
- If staff worked an overtime shift on a Friday or Sunday and manually logged their hours, those hours are counted towards their weekly total.

### 3. Weekly 48-Hour Overtime & Undertime Logic
- Cutoff cycle starts from the **20th day of the month** and ends on the **19th day of the next month**.
- Each 7-day period is calculated as a work week:
  - **Week 1:** Day 1 to 7 (20th – 26th) — Target: 48.0h
  - **Week 2:** Day 8 to 14 (27th – 2nd/3rd) — Target: 48.0h
  - **Week 3:** Day 15 to 21 (3rd/4th – 9th/10th) — Target: 48.0h
  - **Week 4:** Day 22 to 28 (10th/11th – 16th/17th) — Target: 48.0h
  - **Week 5 (Remainder):** Day 29 to cutoff end (18th – 19th) — Prorated target (9.6h/workday).
- **Overtime:** Hours worked above the weekly target.
- **Undertime:** Hours worked below the weekly target.
- **Net Monthly Balance:** Calculated based on the attendance for the whole month (Total Overtime minus Total Undertime).

### 4. Smart Attendance Entry (Mobile & Desktop)
- **Smart Staff Search Box:** Instant autocomplete search by employee name or employee code.
- **Employee Number / Code:** Automatically displayed and linked.
- **Date Validation:** Allows past dates and today; **strictly blocks future dates**.
- **Status Selection:** Support for `Present`, `WO` (Week Off), `OFF` (Unscheduled Off), `Paid Leave` (PL), `Sick Leave` (SL), `Unpaid Leave` (UL), and `Holiday`.
- **Start Time & End Time:** Live calculated duration; automatically supports overnight shifts.
- **Smart Branch Location:** Searchable branch dropdown populated dynamically from the `Locations` sheet.
- **ADD Button:**
  - Prevents duplicate entries on the same date for the same employee.
  - **Retains previously entered data** (employee name, code, location, times) for fast multi-date logging without re-typing.

### 5. 1-Year Rolling Retention Policy
- Attendance logs are saved to the `Attendance_data` sheet in Google Sheets.
- The system automatically keeps the past **365 days (1 year)** of attendance history.
- Older records are automatically pruned to keep Google Sheets lightweight, responsive, and fast.

### 6. Client-Side Formatted Excel Download (`.xlsx`)
- Pure attendance export with formatted summary: Weeks 1–5, Total Worked Hours, Target Hours, Overtime, Undertime, Net Balance, Days Present, and Week Offs.
- Formatted and generated directly in the browser via SheetJS (no external server required).

### 7. 1-Hour Automatic Browser Sync
- Browsers automatically re-sync live attendance data from Google Sheets every **60 minutes** (or on demand via the refresh button).

---

## 🔒 Data Privacy & Google Sheet Structure

The GitHub repository contains **zero hardcoded private staff details or records**. All information is dynamically loaded from your private Google Spreadsheet.

### Google Sheet Tabs Schema

#### 1. `Staff_data`
| Column A | Column B | Column C | Column D | Column E | Column F | Column G | Column H |
|---|---|---|---|---|---|---|---|
| `Sl. No.` | `Employee Code` | `Employee Name` | `Designation` | `Allocated to` | `Whatsapp` | `IMAGE` | `Gmail` |

#### 2. `Locations`
| Column A | Column B | Column C |
|---|---|---|
| `Branch` | `Emr` | `Location` |

#### 3. `Attendance_data`
| Col A | Col B | Col C | Col D | Col E | Col F | Col G | Col H | Col I | Col J |
|---|---|---|---|---|---|---|---|---|---|
| `Timestamp` | `Date` | `Employee Code` | `Employee Name` | `Branch` | `Status` | `Start Time` | `End Time` | `Total Hours` | `Notes` |

---

## 🚀 Deployment & Permanent Connection Setup

To connect your private Google Sheet permanently to GitHub Pages:

1. Open your Google Sheet.
2. In the top menu, navigate to **Extensions > Apps Script**.
3. Copy the entire contents of `google_apps_script.js` and paste it into the editor.
4. Click **Deploy > New deployment**.
   - Select type: **Web app**
   - Description: `Attendance API`
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy** and copy the generated Web App URL (`https://script.google.com/macros/s/.../exec`).
6. Open `static/js/config.js` in this repository and paste the URL:
   ```javascript
   window.APP_CONFIG = {
       GOOGLE_SCRIPT_URL: "https://script.google.com/macros/s/.../exec",
       ...
   };
   ```
7. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "feat: configure google apps script url"
   git push origin main
   ```
8. Every user visiting [https://inventory-choco.github.io/attendance/](https://inventory-choco.github.io/attendance/) on mobile or desktop will now be connected automatically!

---

## 💻 Local Development (Optional FastAPI Server)

```bash
cd "G:\My Drive\OFFICE HP\GitHub\Attendance\attendance"
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```
- Local Application: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- Local API Docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
