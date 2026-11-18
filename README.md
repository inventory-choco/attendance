# Staff Attendance Management System

A high-performance, user-friendly, and reliable Staff Attendance & Overtime/Undertime Tracking Web Application designed specifically for multi-branch staff with flexible daily schedules.

Connected GitHub Repository: `https://github.com/inventory-choco/attendance.git`

---

## 🌟 Core Business Rules & Features

### 1. Flexible Shift Scheduling (48 Hours / Week)
- Staff work varied shifts across different times of the day (e.g., 6 hours one day, 12 hours another day, 8h, 10h).
- Daily schedule is completely flexible as long as they complete **48 Hours in a week**.

### 2. Automatic Week Offs ("WO") on Fridays & Sundays
- **Rule:** Normally every **Sunday** and **Friday** is **"WO" (Week Off)**.
- If staff did not update a shift manually for these days, they automatically show as **"WO"** with zero hours required.
- If staff worked an overtime shift on a Friday or Sunday and manually logged their hours, those hours are credited toward their weekly total.

### 3. Weekly 48-Hour Overtime & Undertime Logic
- Cutoff cycle starts from the **20th day of the month** and ends on the **19th day of the next month**.
- Each 7-day period is calculated as a work week:
  - **Week 1:** Day 1 to 7 (20th – 26th) — Target: 48.0h
  - **Week 2:** Day 8 to 14 (27th – 2nd/3rd) — Target: 48.0h
  - **Week 3:** Day 15 to 21 (3rd/4th – 9th/10th) — Target: 48.0h
  - **Week 4:** Day 22 to 28 (10th/11th – 16th/17th) — Target: 48.0h
  - **Week 5 (Remainder):** Day 29 to cutoff end (18th – 19th) — Prorated target (e.g., 9.6h/workday).
- **Overtime:** Hours worked above the weekly target.
- **Undertime:** Hours below the weekly target.
- **Net Monthly Balance:** Calculated based on the attendance for the whole month (Total Overtime minus Total Undertime).

### 4. Smart Attendance Entry (Desktop & Mobile Friendly)
- **Smart Staff Search Box:** Instant autocomplete search by staff name or employee code (e.g. typing "Amal" or "3002").
- **Employee Number / Code:** Automatically displayed and linked.
- **Date Validation:** Allows past dates and today; **strictly blocks future dates**.
- **Status Selection:** Support for `Present`, `WO` (Week Off), `OFF` (Unscheduled Off), `Paid Leave` (PL), `Sick Leave` (SL), `Unpaid Leave` (UL), and `Holiday`.
- **Start Time & End Time:** Live calculated duration; supports overnight shifts.
- **Smart Branch Location:** Searchable dropdown populated from the `Locations` sheet (DUBAI, ABU DHABI, RAK, FUJAIRAH, SHARJAH, HEAD OFFICE).
- **ADD Button:**
  - Prevents duplicate entries on the same date for the same employee.
  - **Retains previously entered data** (employee name, code, location, times) for fast multi-date logging without re-typing.

### 5. Formatted Excel Download (`.xlsx`)
- Pure attendance export with formatted header, colors for Overtime (green), Undertime (red), and Week Offs (slate/indigo).
- Includes two sheets:
  1. **Attendance Summary:** Staff name, code, branch, Weeks 1–5, Total Worked, Target, Overtime, Undertime, Net Balance, Days Present, WO, and Leaves.
  2. **Daily Attendance Matrix:** Day-by-day log from 20th to 19th.

---

## 👥 Staff Roster (Inventory Department)

| Sl. | Employee Code | Employee Name | Designation | Branch / Allocation | WhatsApp |
|---|---|---|---|---|---|
| 1 | `INV-001` | Shuhaib Muhammed Chirakkattil | Inventory Manager | HEAD OFFICE | +971 502247162 |
| 2 | `INV-002` | Amal Valsan Kumar | Inventory Controller | DUBAI | +971 561775239 |
| 3 | `INV-003` | Alan Mathew Varghese | Inventory Controller | RAK | +971 565637002 |
| 4 | `INV-004` | Jebin Shanthi Susaiah | Inventory Controller | RAK | +971 568211967 |
| 5 | `INV-005` | Athul Kalamkoli Mahendran | Inventory Controller | FUJAIRAH | +971 559436074 |
| 6 | `INV-006` | Kevin Paul Poulose | Inventory Controller | ABU DHABI | +971 568518636 |
| 7 | `INV-007` | Arun Suresh | Inventory Controller | ABU DHABI | +971 504160943 |
| 8 | `INV-008` | Muhammed Shibil | Inventory Controller | DUBAI | +971 568269041 |
| 9 | `INV-009` | Sujith Kumar Maladukkam Vasanth | Inventory Controller | ABU DHABI | +971 589077644 |
| 10 | `INV-010` | Jince Mathew Thulasi Mathew | Inventory Controller | SHARJAH | +971 581347472 |
| 11 | `INV-011` | Pawan Deep Singh Bupinder Singh | Inventory Helper | ABU DHABI | — |
| 12 | `INV-012` | Sikender Singh | Inventory Helper | DUBAI | +91 7009441420 |
| 13 | `INV-013` | Gurudeep Singh Karnail Singh | Inventory Helper | ABU DHABI | +91 9646000717 |
| 14 | `INV-014` | Rahul Mast Ram | Inventory Helper | DUBAI | — |
| 15 | `INV-015` | Gagandeep Singh Mohinder Pal | Inventory Helper | SHARJAH | — |
| 16 | `3002` | Masood (ID: 3002) | Inventory Helper | DUBAI | — |
| 17 | `2987` | Sooraj (ID: 2987) | Inventory Helper | RAK | — |
| 18 | `2999` | Farhan (ID: 2999) | Inventory Helper | ABU DHABI | — |
| 19 | `INV-019` | YOGESH RAVINDER CHHIBBER | Inventory Helper | FUJAIRAH | — |

---

## 🏢 Locations Sheet (Branches)

| Branch | Emirate (Emr) | Location |
|---|---|---|
| **HEAD OFFICE** | Dubai | Head Office - Dubai |
| **DUBAI** | Dubai | Dubai Central Warehouse |
| **ABU DHABI** | Abu Dhabi | Abu Dhabi Branch |
| **RAK** | Ras Al Khaimah | Ras Al Khaimah Depot |
| **FUJAIRAH** | Fujairah | Fujairah Distribution |
| **SHARJAH** | Sharjah | Sharjah Logistics Center |

---

## 🚀 How to Run the Application

### 1-Click Launch on Windows
Double click [run.bat](file:///G:/My%20Drive/OFFICE%20HP/GitHub/Attendance/attendance/run.bat) or run in terminal:
```cmd
cd "G:\My Drive\OFFICE HP\GitHub\Attendance\attendance"
.\run.bat
```

### Manual Run
```bash
cd "G:\My Drive\OFFICE HP\GitHub\Attendance\attendance"
python -m pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
```

Open:
- Application UI: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- API Docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
