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

### 2. Standard Week Offs ("WO") on Thursdays & Saturdays
- **Rule:** Normally every **Thursday** and **Saturday** is treated as **"WO" (Week Off)**.
- If staff did not log a shift for these days, they automatically calculate as **"WO"** with 0 hours required.
- If staff worked an overtime shift on a Thursday or Saturday and manually logged their hours, those hours count towards their weekly worked total.

### 3. Monday-to-Sunday Calendar Weeks within 20th–19th Cutoff
- Cutoff cycle starts from the **20th day of the month** and ends on the **19th day of the next month**.
- Weeks are strictly aligned to standard **Monday to Sunday** calendar weeks:
  - **Week 1:** 20th until that week's Sunday (e.g. Oct 20 [Tue] to Oct 25 [Sun] — Prorated target: 38.4h).
  - **Week 2:** Monday to Sunday (Full 7-day week — Target: 48.0h).
  - **Week 3:** Monday to Sunday (Full 7-day week — Target: 48.0h).
  - **Week 4:** Monday to Sunday (Full 7-day week — Target: 48.0h).
  - **Week 5 (Remainder):** Monday until the 19th cutoff end (e.g. Nov 16 [Mon] to Nov 19 [Thu] — Prorated target: 28.8h).
- **Overtime:** Hours worked above the weekly target.
- **Undertime:** Hours worked below the weekly target.
- **Net Monthly Balance:** Calculated based on the attendance for the whole month (Total Overtime minus Total Undertime).

### 4. Selected Staff Daily Attendance Breakdown (Cards per Week)
- Selecting any staff member immediately displays their **Daily Attendance Cards arranged by Week**.
- Shows worked hours, shift times, and locations day-by-day.
- **Missing Dates Detection:** Working days (Mon, Tue, Wed, Fri, Sun) that have not been logged are flagged with an amber **"Missing / Not Logged"** warning and a 1-click **Log Date** button to record them immediately.

### 5. Multi-Sheet Formatted Excel Download (`.xlsx`)
- Downloads an executive Excel workbook containing **two formatted sheets**:
  1. **"Attendance Summary"**: Overview of all staff, weekly totals, total worked hours, target hours, overtime, undertime, net balance, present days, and week offs.
  2. **"Daily Attendance"**: Detailed day-by-day log for every employee showing Date, Day, Employee Code, Name, Designation, Branch, Status, From Time, To Time, Hours, and Notes.

### 6. Smart Attendance Entry (Mobile & Desktop)
- **Smart Staff Search Box:** Instant autocomplete search by employee name or employee code (e.g. *Shuhaib* or *1742*).
- **Date Validation:** Allows past dates and today; **strictly blocks future dates**.
- **ADD Button:** Prevents duplicates, saves directly to `Attendance_data`, and **retains** the employee name, code, branch, and shift times so you can log multiple dates consecutively with 1 click.

### 7. 1-Year Rolling Retention Policy
- Attendance logs are saved to the `Attendance_data` sheet in Google Sheets.
- The system automatically keeps the past **365 days (1 year)** of attendance history.
- Older records are automatically pruned to keep Google Sheets lightweight, responsive, and fast.

---

## 🔒 Google Sheet Structure

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

## 🚀 Setup & Deployment

### Step 1: Deploy Apps Script
1. Open your Google Sheet: [https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y](https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y)
2. In the top menu, navigate to **Extensions > Apps Script**.
3. Copy the entire contents of `google_apps_script.js` and paste it into the editor.
4. Click **Deploy > New deployment**.
   - Select type: **Web app**
   - Description: `Attendance API v3`
   - Execute as: **Me** (`your-email@gmail.com`)
   - Who has access: **Anyone**  *(Required so GitHub Pages can connect)*
5. Click **Deploy** and copy the generated Web App URL (`https://script.google.com/macros/s/.../exec`).

### Step 2: Configure `static/js/config.js`
Open `static/js/config.js` and paste the URL:
```javascript
window.APP_CONFIG = {
    GOOGLE_SCRIPT_URL: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec",
    GOOGLE_CLIENT_ID: "", // Optional: Paste Google OAuth Client ID for Gmail Sign-In
    ...
};
```

### Step 3: Push to GitHub
```bash
git add .
git commit -m "feat: update attendance system with monday-sunday weeks and 2-sheet excel export"
git push origin main
```
