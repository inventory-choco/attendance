import datetime
from typing import Dict, List, Any, Tuple
from backend.database import get_db, get_setting

def get_cutoff_period(year: int, month: int) -> Tuple[datetime.date, datetime.date]:
    """
    Returns (start_date, end_date) for a cutoff starting on the 20th of the given year/month
    and ending on the 19th of the next month.
    Example: year=2026, month=10 -> (2026-10-20, 2026-11-19)
    """
    start_day = int(get_setting("cutoff_start_day", "20"))
    end_day = int(get_setting("cutoff_end_day", "19"))

    start_date = datetime.date(year, month, start_day)

    if month == 12:
        next_year = year + 1
        next_month = 1
    else:
        next_year = year
        next_month = month + 1

    end_date = datetime.date(next_year, next_month, end_day)
    return start_date, end_date

def get_current_cutoff_cycle() -> Tuple[int, int, datetime.date, datetime.date]:
    """
    Determines the current active cutoff cycle based on today's date.
    If today is >= 20th, cycle started on 20th of this month.
    If today is < 20th, cycle started on 20th of previous month.
    """
    today = datetime.date.today()
    start_day = int(get_setting("cutoff_start_day", "20"))

    if today.day >= start_day:
        cycle_year = today.year
        cycle_month = today.month
    else:
        if today.month == 1:
            cycle_year = today.year - 1
            cycle_month = 12
        else:
            cycle_year = today.year
            cycle_month = today.month - 1

    start_date, end_date = get_cutoff_period(cycle_year, cycle_month)
    return cycle_year, cycle_month, start_date, end_date

def get_available_cycles(count: int = 12) -> List[Dict[str, Any]]:
    """Returns list of past, current, and upcoming cutoff cycles for dropdowns."""
    curr_y, curr_m, _, _ = get_current_cutoff_cycle()
    cycles = []

    for offset in range(-6, 6):
        m = curr_m + offset
        y = curr_y
        while m < 1:
            m += 12
            y -= 1
        while m > 12:
            m -= 12
            y += 1

        s_date, e_date = get_cutoff_period(y, m)
        is_current = (y == curr_y and m == curr_m)
        month_name = s_date.strftime("%B")
        next_month_name = e_date.strftime("%B")

        label = f"{month_name} 20, {s_date.year} – {next_month_name} 19, {e_date.year}"
        if is_current:
            label += " (Current Period)"

        cycles.append({
            "year": y,
            "month": m,
            "start_date": s_date.isoformat(),
            "end_date": e_date.isoformat(),
            "label": label,
            "is_current": is_current
        })

    return cycles

def partition_cycle_into_weeks(start_date: datetime.date, end_date: datetime.date) -> List[Dict[str, Any]]:
    """
    Splits the 20th-19th cutoff period into 7-day weeks starting from the 20th.
    Target is 48.0 Hours for full 7-day weeks.
    Partial week is prorated based on working days (excluding Friday/Sunday).
    """
    weekly_target = float(get_setting("weekly_target_hours", "48.0"))
    prorate_mode = get_setting("prorate_partial_week", "true").lower() == "true"
    daily_std = float(get_setting("daily_standard_hours", "9.6")) # 48h / 5 workdays

    weeks = []
    current_start = start_date
    week_number = 1

    while current_start <= end_date:
        current_end = current_start + datetime.timedelta(days=6)
        if current_end > end_date:
            current_end = end_date

        days_in_week = (current_end - current_start).days + 1

        if days_in_week == 7:
            target_hours = weekly_target
            is_partial = False
        else:
            is_partial = True
            if prorate_mode:
                # Count non-weekend days (excluding Fri=4 and Sun=6)
                workdays_in_partial = 0
                temp = current_start
                while temp <= current_end:
                    if temp.weekday() not in [4, 6]:
                        workdays_in_partial += 1
                    temp += datetime.timedelta(days=1)
                target_hours = round(workdays_in_partial * daily_std, 1)
            else:
                target_hours = weekly_target

        weeks.append({
            "week_number": week_number,
            "start_date": current_start.isoformat(),
            "end_date": current_end.isoformat(),
            "days_count": days_in_week,
            "target_hours": target_hours,
            "is_partial": is_partial,
            "label": f"Week {week_number} ({current_start.strftime('%b %d')} - {current_end.strftime('%b %d')})"
        })

        current_start = current_end + datetime.timedelta(days=1)
        week_number += 1

    return weeks

def calculate_staff_cutoff_report(
    staff_id: int,
    start_date: datetime.date,
    end_date: datetime.date,
    weeks_info: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Calculates detailed attendance, weekly 48-hour compliance, overtime, undertime,
    and handles the rule:
    'Normally every sunday and friday will be "WO": Week off.
     so if they did not update manually for these days, that means that days are "WO".'
    """
    auto_wo_raw = get_setting("auto_week_off_days", "4,6")
    auto_wo_days = [int(x.strip()) for x in auto_wo_raw.split(",") if x.strip().isdigit()]

    with get_db() as conn:
        staff_row = conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone()
        if not staff_row:
            return {}

        dept_row = conn.execute("SELECT name FROM departments WHERE id = ?", (staff_row["department_id"],)).fetchone()
        dept_name = dept_row["name"] if dept_row else "Unknown"

        logs = conn.execute("""
            SELECT date, total_hours, check_in, check_out, break_minutes, status, shift_type, location, notes
            FROM attendance_logs
            WHERE staff_id = ? AND date >= ? AND date <= ?
            ORDER BY date ASC
        """, (staff_id, start_date.isoformat(), end_date.isoformat())).fetchall()

    # Map manual logs by date
    daily_logs_map = {log["date"]: log for log in logs}

    weekly_breakdown = []
    total_month_hours = 0.0
    total_target_hours = 0.0
    total_overtime = 0.0
    total_undertime = 0.0

    days_present_count = 0
    days_wo_count = 0
    days_leave_count = 0

    for w in weeks_info:
        w_start = datetime.date.fromisoformat(w["start_date"])
        w_end = datetime.date.fromisoformat(w["end_date"])
        w_target = float(w["target_hours"])

        w_worked = 0.0
        w_days_detail = []
        curr = w_start

        while curr <= w_end:
            curr_str = curr.isoformat()
            weekday = curr.weekday() # 0=Mon, ..., 4=Fri, 6=Sun

            if curr_str in daily_logs_map:
                log = daily_logs_map[curr_str]
                hours = float(log["total_hours"])
                status = log["status"] or "Present"
                check_in = log["check_in"] or ""
                check_out = log["check_out"] or ""
                is_auto_wo = False
                location = log["location"] or staff_row["allocated_to"]
            else:
                # No manual entry logged
                if weekday in auto_wo_days:
                    # Automatically marked as "WO" (Week Off) per company rule!
                    status = "WO"
                    hours = 0.0
                    check_in = ""
                    check_out = ""
                    is_auto_wo = True
                    location = staff_row["allocated_to"]
                else:
                    status = "Not Logged"
                    hours = 0.0
                    check_in = ""
                    check_out = ""
                    is_auto_wo = False
                    location = staff_row["allocated_to"]

            if status in ["Present", "Regular"]:
                days_present_count += 1
            elif status == "WO":
                days_wo_count += 1
            elif status in ["Paid Leave", "Sick Leave", "Unpaid Leave", "OFF", "Holiday"]:
                days_leave_count += 1

            w_worked += hours
            w_days_detail.append({
                "date": curr_str,
                "day_name": curr.strftime("%a"),
                "day_num": curr.day,
                "weekday": weekday,
                "hours": round(hours, 2),
                "status": status,
                "is_auto_wo": is_auto_wo,
                "check_in": check_in,
                "check_out": check_out,
                "location": location
            })
            curr += datetime.timedelta(days=1)

        w_worked = round(w_worked, 2)
        total_month_hours += w_worked
        total_target_hours += w_target

        if w_worked >= w_target:
            w_overtime = round(w_worked - w_target, 2)
            w_undertime = 0.0
        else:
            w_overtime = 0.0
            w_undertime = round(w_target - w_worked, 2)

        total_overtime += w_overtime
        total_undertime += w_undertime
        w_balance = round(w_worked - w_target, 2)

        weekly_breakdown.append({
            "week_number": w["week_number"],
            "label": w["label"],
            "start_date": w["start_date"],
            "end_date": w["end_date"],
            "days_count": w["days_count"],
            "target_hours": w_target,
            "worked_hours": w_worked,
            "overtime_hours": w_overtime,
            "undertime_hours": w_undertime,
            "net_balance": w_balance,
            "status": "OVERTIME" if w_balance > 0 else ("UNDERTIME" if w_balance < 0 else "TARGET_MET"),
            "days": w_days_detail
        })

    total_month_hours = round(total_month_hours, 2)
    total_target_hours = round(total_target_hours, 2)
    total_overtime = round(total_overtime, 2)
    total_undertime = round(total_undertime, 2)
    net_monthly_balance = round(total_overtime - total_undertime, 2)

    status = "OVERTIME" if net_monthly_balance > 0 else ("UNDERTIME" if net_monthly_balance < 0 else "BALANCED")

    return {
        "staff_id": staff_row["id"],
        "sl_no": staff_row["sl_no"],
        "employee_code": staff_row["employee_code"],
        "name": staff_row["name"],
        "designation": staff_row["designation"],
        "department_id": staff_row["department_id"],
        "department_name": dept_name,
        "allocated_to": staff_row["allocated_to"],
        "whatsapp": staff_row["whatsapp"],
        "image_url": staff_row["image_url"],
        "weekly_breakdown": weekly_breakdown,
        "total_month_hours": total_month_hours,
        "total_target_hours": total_target_hours,
        "total_overtime": total_overtime,
        "total_undertime": total_undertime,
        "net_monthly_balance": net_monthly_balance,
        "days_present_count": days_present_count,
        "days_wo_count": days_wo_count,
        "days_leave_count": days_leave_count,
        "status": status,
        "compliance_percentage": round((total_month_hours / max(total_target_hours, 1.0)) * 100, 1)
    }

def get_full_cutoff_summary(year: int, month: int, department_id: int = None, location: str = None) -> Dict[str, Any]:
    """Generates the master cutoff attendance report for all staff for the selected cycle."""
    start_date, end_date = get_cutoff_period(year, month)
    weeks_info = partition_cycle_into_weeks(start_date, end_date)

    query = "SELECT id FROM staff WHERE is_active = 1"
    params = []
    if department_id:
        query += " AND department_id = ?"
        params.append(department_id)
    if location and location.upper() != "ALL":
        query += " AND UPPER(allocated_to) = UPPER(?)"
        params.append(location)

    query += " ORDER BY sl_no ASC, id ASC"

    with get_db() as conn:
        staff_rows = conn.execute(query, params).fetchall()

    staff_reports = []
    total_staff = len(staff_rows)
    aggregate_hours = 0.0
    aggregate_overtime = 0.0
    aggregate_undertime = 0.0
    overtime_staff_count = 0
    undertime_staff_count = 0
    balanced_staff_count = 0

    for s in staff_rows:
        rep = calculate_staff_cutoff_report(s["id"], start_date, end_date, weeks_info)
        staff_reports.append(rep)

        aggregate_hours += rep["total_month_hours"]
        aggregate_overtime += rep["total_overtime"]
        aggregate_undertime += rep["total_undertime"]

        if rep["net_monthly_balance"] > 0:
            overtime_staff_count += 1
        elif rep["net_monthly_balance"] < 0:
            undertime_staff_count += 1
        else:
            balanced_staff_count += 1

    net_aggregate_balance = round(aggregate_overtime - aggregate_undertime, 2)

    return {
        "cycle_info": {
            "year": year,
            "month": month,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "label": f"{start_date.strftime('%B %d, %Y')} – {end_date.strftime('%B %d, %Y')}",
            "total_days": (end_date - start_date).days + 1,
            "weeks": weeks_info
        },
        "stats": {
            "total_staff": total_staff,
            "aggregate_hours": round(aggregate_hours, 2),
            "aggregate_overtime": round(aggregate_overtime, 2),
            "aggregate_undertime": round(aggregate_undertime, 2),
            "net_aggregate_balance": net_aggregate_balance,
            "overtime_staff_count": overtime_staff_count,
            "undertime_staff_count": undertime_staff_count,
            "balanced_staff_count": balanced_staff_count
        },
        "staff_reports": staff_reports
    }
