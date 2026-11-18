import datetime
from backend.database import get_db, init_db

LOCATIONS_DATA = [
    {"branch": "HEAD OFFICE", "emr": "Dubai", "location": "Head Office - Dubai"},
    {"branch": "DUBAI", "emr": "Dubai", "location": "Dubai Central Warehouse"},
    {"branch": "ABU DHABI", "emr": "Abu Dhabi", "location": "Abu Dhabi Branch"},
    {"branch": "RAK", "emr": "Ras Al Khaimah", "location": "Ras Al Khaimah Depot"},
    {"branch": "FUJAIRAH", "emr": "Fujairah", "location": "Fujairah Distribution"},
    {"branch": "SHARJAH", "emr": "Sharjah", "location": "Sharjah Logistics Center"},
]

STAFF_DATA = [
    {"sl_no": 1, "code": "INV-001", "name": "Shuhaib Muhammed Chirakkattil", "designation": "Inventory Manager", "allocated_to": "HEAD OFFICE", "whatsapp": "502247162"},
    {"sl_no": 2, "code": "INV-002", "name": "Amal Valsan Kumar", "designation": "Inventory Controller", "allocated_to": "DUBAI", "whatsapp": "561775239"},
    {"sl_no": 3, "code": "INV-003", "name": "Alan Mathew Varghese", "designation": "Inventory Controller", "allocated_to": "RAK", "whatsapp": "565637002"},
    {"sl_no": 4, "code": "INV-004", "name": "Jebin Shanthi Susaiah", "designation": "Inventory Controller", "allocated_to": "RAK", "whatsapp": "568211967"},
    {"sl_no": 5, "code": "INV-005", "name": "Athul Kalamkoli Mahendran", "designation": "Inventory Controller", "allocated_to": "FUJAIRAH", "whatsapp": "559436074"},
    {"sl_no": 6, "code": "INV-006", "name": "Kevin Paul Poulose", "designation": "Inventory Controller", "allocated_to": "ABU DHABI", "whatsapp": "568518636"},
    {"sl_no": 7, "code": "INV-007", "name": "Arun Suresh", "designation": "Inventory Controller", "allocated_to": "ABU DHABI", "whatsapp": "504160943"},
    {"sl_no": 8, "code": "INV-008", "name": "Muhammed Shibil", "designation": "Inventory Controller", "allocated_to": "DUBAI", "whatsapp": "568269041"},
    {"sl_no": 9, "code": "INV-009", "name": "Sujith Kumar Maladukkam Vasanth", "designation": "Inventory Controller", "allocated_to": "ABU DHABI", "whatsapp": "589077644"},
    {"sl_no": 10, "code": "INV-010", "name": "Jince Mathew Thulasi Mathew", "designation": "Inventory Controller", "allocated_to": "SHARJAH", "whatsapp": "581347472"},
    {"sl_no": 11, "code": "INV-011", "name": "Pawan Deep Singh Bupinder Singh", "designation": "Inventory Helper", "allocated_to": "ABU DHABI", "whatsapp": ""},
    {"sl_no": 12, "code": "INV-012", "name": "Sikender Singh", "designation": "Inventory Helper", "allocated_to": "DUBAI", "whatsapp": "917009441420"},
    {"sl_no": 13, "code": "INV-013", "name": "Gurudeep Singh Karnail Singh", "designation": "Inventory Helper", "allocated_to": "ABU DHABI", "whatsapp": "919646000717"},
    {"sl_no": 14, "code": "INV-014", "name": "Rahul Mast Ram", "designation": "Inventory Helper", "allocated_to": "DUBAI", "whatsapp": ""},
    {"sl_no": 15, "code": "INV-015", "name": "Gagandeep Singh Mohinder Pal", "designation": "Inventory Helper", "allocated_to": "SHARJAH", "whatsapp": ""},
    {"sl_no": 16, "code": "3002", "name": "Masood (ID: 3002)", "designation": "Inventory Helper", "allocated_to": "DUBAI", "whatsapp": ""},
    {"sl_no": 17, "code": "2987", "name": "Sooraj (ID: 2987)", "designation": "Inventory Helper", "allocated_to": "RAK", "whatsapp": ""},
    {"sl_no": 18, "code": "2999", "name": "Farhan (ID: 2999)", "designation": "Inventory Helper", "allocated_to": "ABU DHABI", "whatsapp": ""},
    {"sl_no": 19, "code": "INV-019", "name": "YOGESH RAVINDER CHHIBBER", "designation": "Inventory Helper", "allocated_to": "FUJAIRAH", "whatsapp": ""},
]

def format_whatsapp(raw_number: str) -> str:
    """Standardizes phone number for WhatsApp wa.me links."""
    if not raw_number:
        return ""
    cleaned = "".join(ch for ch in str(raw_number) if ch.isdigit())
    if not cleaned:
        return ""
    if len(cleaned) == 9 and cleaned.startswith("5"):
        return "971" + cleaned
    if len(cleaned) == 10 and cleaned.startswith("05"):
        return "971" + cleaned[1:]
    return cleaned

def seed_database():
    init_db()
    now_str = datetime.datetime.now().isoformat()

    with get_db() as conn:
        cursor = conn.cursor()

        # 1. Insert Locations
        for loc in LOCATIONS_DATA:
            cursor.execute("""
                INSERT OR IGNORE INTO locations (branch, emr, location, created_at)
                VALUES (?, ?, ?, ?)
            """, (loc["branch"], loc["emr"], loc["location"], now_str))

        # 2. Insert "Inventory" Department
        cursor.execute("SELECT id FROM departments WHERE name = 'Inventory'")
        dept_row = cursor.fetchone()
        if not dept_row:
            cursor.execute("""
                INSERT INTO departments (name, description, created_at)
                VALUES ('Inventory', 'Inventory management, tracking, controllers and warehouse helpers', ?)
            """, (now_str,))
            dept_id = cursor.lastrowid
        else:
            dept_id = dept_row["id"]

        # 3. Insert / Update Staff Members
        for s in STAFF_DATA:
            cursor.execute("SELECT id FROM staff WHERE employee_code = ? OR name = ?", (s["code"], s["name"]))
            existing_staff = cursor.fetchone()
            formatted_wa = format_whatsapp(s["whatsapp"])
            avatar = f"https://api.dicebear.com/7.x/initials/svg?seed={s['name']}&backgroundColor=0284c7,0d9488,4f46e5,7c3aed&textColor=ffffff"

            if not existing_staff:
                cursor.execute("""
                    INSERT INTO staff (
                        sl_no, employee_code, name, designation, department_id,
                        allocated_to, whatsapp, image_url, is_active, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                """, (
                    s["sl_no"], s["code"], s["name"], s["designation"], dept_id,
                    s["allocated_to"], formatted_wa, avatar, now_str, now_str
                ))
            else:
                cursor.execute("""
                    UPDATE staff SET sl_no = ?, employee_code = ?, designation = ?, allocated_to = ?, whatsapp = ?
                    WHERE id = ?
                """, (s["sl_no"], s["code"], s["designation"], s["allocated_to"], formatted_wa, existing_staff["id"]))

        # 4. Check if sample attendance records exist; if not, seed realistic shifts
        cursor.execute("SELECT COUNT(*) as cnt FROM attendance_logs")
        logs_count = cursor.fetchone()["cnt"]

        if logs_count == 0:
            seed_sample_attendance(conn, dept_id)

def seed_sample_attendance(conn, dept_id):
    """
    Seeds realistic attendance data with varied schedules:
    - Automatically marks Friday (weekday 4) and Sunday (weekday 6) as 'WO' (Week Off) if no shift.
    - Some days 6 hours, some days 12 hours, some days 8h, 10h.
    - Demonstrates 48-hour compliance, overtime, and undertime without any salary terms.
    """
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, allocated_to FROM staff WHERE department_id = ?", (dept_id,))
    staff_list = cursor.fetchall()

    start_date = datetime.date(2026, 10, 20)
    end_date = datetime.date(2026, 11, 19)
    current_date = start_date

    date_list = []
    while current_date <= end_date:
        date_list.append(current_date)
        current_date += datetime.timedelta(days=1)

    now_str = datetime.datetime.now().isoformat()

    # Schedule rotation per staff:
    # Notice: weekday 4 is Friday, weekday 6 is Sunday.
    # In normal rotation: Monday(0), Tuesday(1), Wednesday(2), Thursday(3), Saturday(5) are working days.
    # Friday(4) and Sunday(6) are Week Off ("WO").
    for staff_idx, staff in enumerate(staff_list):
        for d in date_list:
            weekday = d.weekday()  # Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6

            # Friday & Sunday are WO by default
            if weekday in [4, 6]:
                # In rare cases, an overtime worker works on Sunday or Friday
                if staff_idx == 0 and weekday == 4 and d.day == 24: # Shuhaib worked an emergency 8h on a Friday
                    cursor.execute("""
                        INSERT OR IGNORE INTO attendance_logs (
                            staff_id, date, check_in, check_out, break_minutes,
                            total_hours, status, shift_type, location, notes, created_at, updated_at
                        ) VALUES (?, ?, '09:00', '17:00', 0, 8.0, 'Present', 'Overtime Shift', ?, 'Friday stock emergency', ?, ?)
                    """, (staff["id"], d.isoformat(), staff["allocated_to"], now_str, now_str))
                else:
                    # Automatic WO
                    cursor.execute("""
                        INSERT OR IGNORE INTO attendance_logs (
                            staff_id, date, check_in, check_out, break_minutes,
                            total_hours, status, shift_type, location, notes, created_at, updated_at
                        ) VALUES (?, ?, '', '', 0, 0.0, 'WO', 'Week Off', ?, 'Scheduled Week Off', ?, ?)
                    """, (staff["id"], d.isoformat(), staff["allocated_to"], now_str, now_str))
            else:
                # Working day: rotate between 6h, 12h, 10h, 8h, or occasional Paid Leave
                if staff_idx == 4 and d.day == 26:
                    # Paid Leave example
                    cursor.execute("""
                        INSERT OR IGNORE INTO attendance_logs (
                            staff_id, date, check_in, check_out, break_minutes,
                            total_hours, status, shift_type, location, notes, created_at, updated_at
                        ) VALUES (?, ?, '', '', 0, 8.0, 'Paid Leave', 'Leave', ?, 'Approved Annual Leave', ?, ?)
                    """, (staff["id"], d.isoformat(), staff["allocated_to"], now_str, now_str))
                elif staff_idx == 5 and d.day == 27:
                    # Unscheduled Off example
                    cursor.execute("""
                        INSERT OR IGNORE INTO attendance_logs (
                            staff_id, date, check_in, check_out, break_minutes,
                            total_hours, status, shift_type, location, notes, created_at, updated_at
                        ) VALUES (?, ?, '', '', 0, 0.0, 'OFF', 'Off Day', ?, 'Personal Off', ?, ?)
                    """, (staff["id"], d.isoformat(), staff["allocated_to"], now_str, now_str))
                else:
                    # Vary hours: 6h, 12h, 10h, 9.6h
                    hours_choices = [9.6, 12.0, 6.0, 10.0, 10.5, 8.0]
                    hours = hours_choices[(staff_idx + d.day) % len(hours_choices)]
                    check_in = "08:00"
                    if hours == 6.0:
                        check_in, check_out = "09:00", "15:00"
                    elif hours == 12.0:
                        check_in, check_out = "08:00", "20:00"
                    elif hours == 10.0:
                        check_in, check_out = "08:30", "18:30"
                    else:
                        check_in, check_out = "08:00", "17:36"

                    cursor.execute("""
                        INSERT OR IGNORE INTO attendance_logs (
                            staff_id, date, check_in, check_out, break_minutes,
                            total_hours, status, shift_type, location, notes, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, 0, ?, 'Present', 'Regular', ?, 'Scheduled Shift', ?, ?)
                    """, (staff["id"], d.isoformat(), check_in, check_out, hours, staff["allocated_to"], now_str, now_str))

if __name__ == "__main__":
    seed_database()
    print("Seeded pure attendance database successfully.")
