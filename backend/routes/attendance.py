import datetime
from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from backend.database import get_db
from backend.models import AttendancePunch, DailyHoursEntry, BulkDailyEntry

router = APIRouter(prefix="/api/attendance", tags=["Attendance"])

def calculate_hours(check_in: str, check_out: str, break_minutes: int = 0) -> float:
    """Calculates decimal hours worked between two time strings HH:MM."""
    if not check_in or not check_out:
        return 0.0
    try:
        t_in = datetime.datetime.strptime(check_in.strip(), "%H:%M")
        t_out = datetime.datetime.strptime(check_out.strip(), "%H:%M")

        # Handle overnight shifts (e.g. 20:00 to 06:00 next day)
        if t_out < t_in:
            t_out += datetime.timedelta(days=1)

        diff = (t_out - t_in).total_seconds() / 3600.0
        worked = max(0.0, diff - (break_minutes / 60.0))
        return round(worked, 2)
    except Exception:
        return 0.0

@router.get("/logs")
def get_attendance_logs(
    start_date: str = Query(..., description="YYYY-MM-DD"),
    end_date: str = Query(..., description="YYYY-MM-DD"),
    staff_id: Optional[int] = None,
    department_id: Optional[int] = None,
    location: Optional[str] = None
):
    query = """
        SELECT a.*, s.name as staff_name, s.employee_code, s.designation, s.allocated_to, d.name as department_name
        FROM attendance_logs a
        JOIN staff s ON s.id = a.staff_id
        JOIN departments d ON d.id = s.department_id
        WHERE a.date >= ? AND a.date <= ?
    """
    params = [start_date, end_date]

    if staff_id:
        query += " AND a.staff_id = ?"
        params.append(staff_id)
    if department_id:
        query += " AND s.department_id = ?"
        params.append(department_id)
    if location and location.upper() != "ALL":
        query += " AND UPPER(a.location) = UPPER(?)"
        params.append(location)

    query += " ORDER BY a.date DESC, s.sl_no ASC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
        return {"logs": rows, "count": len(rows)}

@router.post("/punch")
def log_punch(punch: AttendancePunch, allow_update: bool = False):
    """
    Logs an attendance shift with strict validation:
    - Date cannot be in the future (today or past dates allowed).
    - Prevents duplicate entries on the same date unless allow_update=True.
    - Supports statuses: Present, WO (Week Off), OFF, Paid Leave, Sick Leave, Unpaid Leave, Holiday.
    """
    now_str = datetime.datetime.now().isoformat()
    today_str = datetime.date.today().isoformat()

    # Rule: Future dates are not allowed
    if punch.date > today_str:
        raise HTTPException(
            status_code=400,
            detail=f"Future dates are not allowed. You selected {punch.date}, but today is {today_str}."
        )

    # Determine hours based on status
    status = punch.status or "Present"
    if status in ["WO", "OFF", "Unpaid Leave"]:
        total_hours = 0.0
        check_in = punch.check_in or ""
        check_out = punch.check_out or ""
    elif status == "Paid Leave":
        total_hours = 8.0 if punch.total_hours is None else float(punch.total_hours)
        check_in = punch.check_in or ""
        check_out = punch.check_out or ""
    else:
        # Present or Regular shift
        if punch.total_hours is not None and punch.total_hours > 0:
            total_hours = round(float(punch.total_hours), 2)
        elif punch.check_in and punch.check_out:
            total_hours = calculate_hours(punch.check_in, punch.check_out, punch.break_minutes or 0)
        else:
            total_hours = 0.0
        check_in = punch.check_in or ""
        check_out = punch.check_out or ""

    with get_db() as conn:
        staff = conn.execute(
            "SELECT id, name, employee_code, allocated_to FROM staff WHERE id = ?",
            (punch.staff_id,)
        ).fetchone()
        if not staff:
            raise HTTPException(status_code=404, detail="Staff member not found")

        loc = punch.location.strip().upper() if punch.location else staff["allocated_to"]

        # Check for existing entry on this date
        existing = conn.execute(
            "SELECT id, status, total_hours FROM attendance_logs WHERE staff_id = ? AND date = ?",
            (punch.staff_id, punch.date)
        ).fetchone()

        if existing and not allow_update:
            # Rule: Do not allow same data to be added twice
            raise HTTPException(
                status_code=409,
                detail=f"Attendance already logged for {staff['name']} ({staff['employee_code']}) on {punch.date}. Cannot add duplicate."
            )

        if existing and allow_update:
            conn.execute("""
                UPDATE attendance_logs
                SET check_in = ?, check_out = ?, break_minutes = ?, total_hours = ?,
                    status = ?, shift_type = ?, location = ?, notes = ?, updated_at = ?
                WHERE id = ?
            """, (
                check_in, check_out, punch.break_minutes or 0,
                total_hours, status, punch.shift_type or 'Regular', loc, punch.notes,
                now_str, existing["id"]
            ))
            return {
                "id": existing["id"],
                "staff_name": staff["name"],
                "employee_code": staff["employee_code"],
                "date": punch.date,
                "status": status,
                "total_hours": total_hours,
                "location": loc,
                "message": f"Updated attendance for {staff['name']} on {punch.date}"
            }
        else:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO attendance_logs (
                    staff_id, date, check_in, check_out, break_minutes,
                    total_hours, status, shift_type, location, notes, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                punch.staff_id, punch.date, check_in, check_out,
                punch.break_minutes or 0, total_hours, status, punch.shift_type or 'Regular',
                loc, punch.notes, now_str, now_str
            ))
            return {
                "id": cursor.lastrowid,
                "staff_name": staff["name"],
                "employee_code": staff["employee_code"],
                "date": punch.date,
                "status": status,
                "total_hours": total_hours,
                "location": loc,
                "message": f"Successfully added {status} ({total_hours}h) for {staff['name']} on {punch.date}"
            }

@router.post("/daily-hours")
def set_daily_hours(entry: DailyHoursEntry):
    """Fast inline grid cell update for supervisors."""
    now_str = datetime.datetime.now().isoformat()
    today_str = datetime.date.today().isoformat()

    if entry.date > today_str:
        raise HTTPException(status_code=400, detail="Cannot enter attendance for future dates")

    with get_db() as conn:
        staff = conn.execute("SELECT id, allocated_to FROM staff WHERE id = ?", (entry.staff_id,)).fetchone()
        if not staff:
            raise HTTPException(status_code=404, detail="Staff not found")

        existing = conn.execute("SELECT id FROM attendance_logs WHERE staff_id = ? AND date = ?",
                                (entry.staff_id, entry.date)).fetchone()

        status = entry.status or ("Present" if entry.total_hours > 0 else "OFF")

        if existing:
            conn.execute("""
                UPDATE attendance_logs
                SET total_hours = ?, status = ?, updated_at = ?
                WHERE id = ?
            """, (round(entry.total_hours, 2), status, now_str, existing["id"]))
        else:
            conn.execute("""
                INSERT INTO attendance_logs (
                    staff_id, date, total_hours, status, shift_type, location, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'Regular', ?, ?, ?)
            """, (
                entry.staff_id, entry.date, round(entry.total_hours, 2),
                status, staff["allocated_to"], now_str, now_str
            ))

        return {"message": "Hours saved", "staff_id": entry.staff_id, "date": entry.date, "total_hours": entry.total_hours}

@router.post("/bulk-daily")
def bulk_set_daily_hours(payload: BulkDailyEntry):
    """Batch updates daily hours for multiple staff and dates in a single fast transaction."""
    now_str = datetime.datetime.now().isoformat()
    today_str = datetime.date.today().isoformat()
    updated_count = 0

    with get_db() as conn:
        for entry in payload.entries:
            if entry.date > today_str:
                continue  # skip future dates safely

            hours = round(float(entry.total_hours), 2)
            status = entry.status or ("Present" if hours > 0 else "OFF")

            existing = conn.execute(
                "SELECT id FROM attendance_logs WHERE staff_id = ? AND date = ?",
                (entry.staff_id, entry.date)
            ).fetchone()

            if existing:
                conn.execute(
                    "UPDATE attendance_logs SET total_hours = ?, status = ?, updated_at = ? WHERE id = ?",
                    (hours, status, now_str, existing["id"])
                )
            else:
                staff = conn.execute("SELECT allocated_to FROM staff WHERE id = ?", (entry.staff_id,)).fetchone()
                loc = staff["allocated_to"] if staff else "HEAD OFFICE"
                conn.execute("""
                    INSERT INTO attendance_logs (
                        staff_id, date, total_hours, status, shift_type, location, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'Regular', ?, ?, ?)
                """, (entry.staff_id, entry.date, hours, status, loc, now_str, now_str))
            updated_count += 1

    return {"message": f"Successfully updated {updated_count} records", "updated_count": updated_count}

@router.delete("/logs/{log_id}")
def delete_attendance_log(log_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM attendance_logs WHERE id = ?", (log_id,))
        return {"message": "Attendance record deleted"}
