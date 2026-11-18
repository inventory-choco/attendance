import io
import datetime
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from typing import Optional
from backend.business_logic import (
    get_cutoff_period,
    get_current_cutoff_cycle,
    get_available_cycles,
    get_full_cutoff_summary,
    calculate_staff_cutoff_report,
    partition_cycle_into_weeks
)
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

router = APIRouter(prefix="/api/reports", tags=["Reports"])

@router.get("/cycles")
def list_cycles():
    """Returns available cutoff cycles for UI selector."""
    return {"cycles": get_available_cycles()}

@router.get("/cutoff-summary")
def get_cutoff_summary_report(
    year: Optional[int] = None,
    month: Optional[int] = None,
    department_id: Optional[int] = None,
    location: Optional[str] = None
):
    """
    Returns the complete monthly attendance report starting from the 20th to 19th of next month.
    Includes weekly breakdowns (Weeks 1-5), 48-hour compliance, Overtime, Undertime, and Week Offs.
    Purely attendance - no salary data.
    """
    if not year or not month:
        curr_y, curr_m, _, _ = get_current_cutoff_cycle()
        year = curr_y if not year else year
        month = curr_m if not month else month

    summary = get_full_cutoff_summary(year, month, department_id, location)
    return summary

@router.get("/staff-monthly/{staff_id}")
def get_individual_staff_report(
    staff_id: int,
    year: Optional[int] = None,
    month: Optional[int] = None
):
    if not year or not month:
        curr_y, curr_m, _, _ = get_current_cutoff_cycle()
        year = curr_y if not year else year
        month = curr_m if not month else month

    start_date, end_date = get_cutoff_period(year, month)
    weeks_info = partition_cycle_into_weeks(start_date, end_date)
    rep = calculate_staff_cutoff_report(staff_id, start_date, end_date, weeks_info)

    if not rep:
        raise HTTPException(status_code=404, detail="Staff not found")

    return rep

@router.get("/export/excel")
def export_excel_report(
    year: Optional[int] = None,
    month: Optional[int] = None,
    department_id: Optional[int] = None,
    location: Optional[str] = None
):
    """Generates an executive-formatted pure attendance Excel workbook (.xlsx)."""
    if not year or not month:
        curr_y, curr_m, _, _ = get_current_cutoff_cycle()
        year = curr_y if not year else year
        month = curr_m if not month else month

    summary = get_full_cutoff_summary(year, month, department_id, location)
    cycle = summary["cycle_info"]
    reports = summary["staff_reports"]

    wb = openpyxl.Workbook()

    # ----------------------------------------------------
    # SHEET 1: Cutoff Summary (Weekly & Totals)
    # ----------------------------------------------------
    ws1 = wb.active
    ws1.title = "Attendance Summary"

    header_fill = PatternFill(start_color="0F172A", end_color="0F172A", fill_type="solid") # Deep Slate Navy
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")

    ot_fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid") # Light Emerald
    ot_font = Font(name="Calibri", size=10, bold=True, color="166534")

    ut_fill = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid") # Light Rose
    ut_font = Font(name="Calibri", size=10, bold=True, color="991B1B")

    wo_fill = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
    wo_font = Font(name="Calibri", size=10, color="475569")

    center_align = Alignment(horizontal="center", vertical="center")
    left_align = Alignment(horizontal="left", vertical="center")
    right_align = Alignment(horizontal="right", vertical="center")

    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )

    # Title Banner
    ws1.merge_cells("A1:Q1")
    ws1["A1"] = f"STAFF ATTENDANCE REPORT — CUTOFF PERIOD: {cycle['label']}"
    ws1["A1"].font = Font(name="Calibri", size=14, bold=True, color="0F172A")
    ws1["A1"].alignment = left_align

    ws1.merge_cells("A2:Q2")
    ws1["A2"] = "Weekly Target: 48.0 Hours | Automatic Week Off (WO) on Fridays & Sundays | Overtime & Undertime Tracked per Week"
    ws1["A2"].font = Font(name="Calibri", size=10, italic=True, color="64748B")

    headers1 = [
        "Sl.", "Code", "Employee Name", "Designation", "Branch", "WhatsApp",
        "W1 (48h)", "W2 (48h)", "W3 (48h)", "W4 (48h)", "W5 Rem",
        "Total Worked", "Target Hrs", "Overtime (OT)", "Undertime (UT)", "Net Balance",
        "Days Present", "Week Offs (WO)", "Leaves/Off"
    ]

    row_num = 4
    for col_idx, h in enumerate(headers1, 1):
        cell = ws1.cell(row=row_num, column=col_idx, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border

    row_num = 5
    for s in reports:
        wb_weeks = {w["week_number"]: w["worked_hours"] for w in s["weekly_breakdown"]}

        ws1.cell(row=row_num, column=1, value=s["sl_no"]).alignment = center_align
        ws1.cell(row=row_num, column=2, value=s["employee_code"]).alignment = center_align
        ws1.cell(row=row_num, column=3, value=s["name"]).alignment = left_align
        ws1.cell(row=row_num, column=4, value=s["designation"]).alignment = left_align
        ws1.cell(row=row_num, column=5, value=s["allocated_to"]).alignment = center_align
        ws1.cell(row=row_num, column=6, value=s["whatsapp"]).alignment = center_align

        ws1.cell(row=row_num, column=7, value=wb_weeks.get(1, 0.0)).alignment = right_align
        ws1.cell(row=row_num, column=8, value=wb_weeks.get(2, 0.0)).alignment = right_align
        ws1.cell(row=row_num, column=9, value=wb_weeks.get(3, 0.0)).alignment = right_align
        ws1.cell(row=row_num, column=10, value=wb_weeks.get(4, 0.0)).alignment = right_align
        ws1.cell(row=row_num, column=11, value=wb_weeks.get(5, 0.0)).alignment = right_align

        ws1.cell(row=row_num, column=12, value=s["total_month_hours"]).alignment = right_align
        ws1.cell(row=row_num, column=13, value=s["total_target_hours"]).alignment = right_align

        # OT Cell
        ot_cell = ws1.cell(row=row_num, column=14, value=s["total_overtime"])
        ot_cell.alignment = right_align
        if s["total_overtime"] > 0:
            ot_cell.fill = ot_fill
            ot_cell.font = ot_font

        # UT Cell
        ut_cell = ws1.cell(row=row_num, column=15, value=s["total_undertime"])
        ut_cell.alignment = right_align
        if s["total_undertime"] > 0:
            ut_cell.fill = ut_fill
            ut_cell.font = ut_font

        # Net Balance
        net_cell = ws1.cell(row=row_num, column=16, value=s["net_monthly_balance"])
        net_cell.alignment = right_align
        if s["net_monthly_balance"] > 0:
            net_cell.fill = ot_fill
            net_cell.font = ot_font
        elif s["net_monthly_balance"] < 0:
            net_cell.fill = ut_fill
            net_cell.font = ut_font

        ws1.cell(row=row_num, column=17, value=s["days_present_count"]).alignment = center_align
        ws1.cell(row=row_num, column=18, value=s["days_wo_count"]).alignment = center_align
        ws1.cell(row=row_num, column=19, value=s["days_leave_count"]).alignment = center_align

        for col_idx in range(1, len(headers1) + 1):
            ws1.cell(row=row_num, column=col_idx).border = thin_border

        row_num += 1

    for col in ws1.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws1.column_dimensions[col_letter].width = max(max_len + 3, 11)

    # ----------------------------------------------------
    # SHEET 2: Daily Attendance Matrix (Day 20 to 19)
    # ----------------------------------------------------
    ws2 = wb.create_sheet(title="Daily Attendance Matrix")

    ws2.merge_cells("A1:D1")
    ws2["A1"] = f"DAILY ATTENDANCE LOG ({cycle['label']})"
    ws2["A1"].font = Font(name="Calibri", size=13, bold=True, color="0F172A")

    # Collect all day dates
    all_days = []
    if reports and reports[0]["weekly_breakdown"]:
        for w in reports[0]["weekly_breakdown"]:
            for d in w["days"]:
                all_days.append(d)

    headers2 = ["Code", "Employee Name", "Branch"] + [f"{d['day_num']} {d['day_name']}" for d in all_days] + ["Total Hours"]
    row_num = 3
    for col_idx, h in enumerate(headers2, 1):
        cell = ws2.cell(row=row_num, column=col_idx, value=h)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = center_align
        cell.border = thin_border

    row_num = 4
    for s in reports:
        ws2.cell(row=row_num, column=1, value=s["employee_code"]).alignment = center_align
        ws2.cell(row=row_num, column=2, value=s["name"]).alignment = left_align
        ws2.cell(row=row_num, column=3, value=s["allocated_to"]).alignment = center_align

        # Flatten days for this staff
        col_idx = 4
        for w in s["weekly_breakdown"]:
            for d in w["days"]:
                cell = ws2.cell(row=row_num, column=col_idx)
                if d["status"] == "WO":
                    cell.value = "WO"
                    cell.fill = wo_fill
                    cell.font = wo_font
                elif d["status"] in ["Paid Leave", "PL"]:
                    cell.value = "PL"
                    cell.fill = ot_fill
                    cell.font = ot_font
                elif d["status"] in ["OFF", "Sick Leave", "SL", "Unpaid Leave", "UL"]:
                    cell.value = d["status"][:3].upper()
                    cell.fill = ut_fill
                    cell.font = ut_font
                elif d["hours"] > 0:
                    cell.value = d["hours"]
                    cell.font = Font(name="Calibri", size=10, bold=True)
                else:
                    cell.value = "-"
                    cell.font = Font(name="Calibri", size=10, color="94A3B8")

                cell.alignment = center_align
                cell.border = thin_border
                col_idx += 1

        tot_cell = ws2.cell(row=row_num, column=col_idx, value=s["total_month_hours"])
        tot_cell.alignment = right_align
        tot_cell.font = Font(name="Calibri", size=10, bold=True)
        tot_cell.border = thin_border

        for c in range(1, 4):
            ws2.cell(row=row_num, column=c).border = thin_border

        row_num += 1

    for col in ws2.columns:
        col_letter = get_column_letter(col[0].column)
        ws2.column_dimensions[col_letter].width = 9 if col[0].column > 3 else 18

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    filename = f"Staff_Attendance_Report_{year}_{month:02d}.xlsx"
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@router.get("/export/csv")
def export_csv_report(
    year: Optional[int] = None,
    month: Optional[int] = None,
    department_id: Optional[int] = None,
    location: Optional[str] = None
):
    """Pure attendance CSV report."""
    if not year or not month:
        curr_y, curr_m, _, _ = get_current_cutoff_cycle()
        year = curr_y if not year else year
        month = curr_m if not month else month

    summary = get_full_cutoff_summary(year, month, department_id, location)
    reports = summary["staff_reports"]

    output = io.StringIO()
    output.write("Sl,Employee_Code,Employee_Name,Designation,Branch,WhatsApp,Week1_Hours,Week2_Hours,Week3_Hours,Week4_Hours,Week5_Hours,Total_Worked,Target_Hours,Overtime,Undertime,Net_Balance,Status,Days_Present,Days_WO,Days_Leaves\n")

    for s in reports:
        wbs = {w["week_number"]: w["worked_hours"] for w in s["weekly_breakdown"]}
        line = f"{s['sl_no']},\"{s['employee_code']}\",\"{s['name']}\",\"{s['designation']}\",\"{s['allocated_to']}\",\"{s['whatsapp']}\"," \
               f"{wbs.get(1, 0.0)},{wbs.get(2, 0.0)},{wbs.get(3, 0.0)},{wbs.get(4, 0.0)},{wbs.get(5, 0.0)}," \
               f"{s['total_month_hours']},{s['total_target_hours']},{s['total_overtime']},{s['total_undertime']}," \
               f"{s['net_monthly_balance']},\"{s['status']}\",{s['days_present_count']},{s['days_wo_count']},{s['days_leave_count']}\n"
        output.write(line)

    output.seek(0)
    filename = f"Staff_Attendance_Report_{year}_{month:02d}.csv"
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
