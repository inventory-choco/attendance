import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

DB_PATH = DATA_DIR / "attendance.db"

# Google Sheet default configuration
DEFAULT_GOOGLE_SHEET_ID = "1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y"
DEFAULT_GOOGLE_SHEET_URL = f"https://docs.google.com/spreadsheets/d/{DEFAULT_GOOGLE_SHEET_ID}/edit?usp=sharing"

# Default Business Rules (Purely Attendance - No Salary)
DEFAULT_SETTINGS = {
    "cutoff_start_day": "20",           # Cycle starts on 20th of month M
    "cutoff_end_day": "19",             # Cycle ends on 19th of month M+1
    "weekly_target_hours": "48.0",       # 48 hours required per week
    "prorate_partial_week": "true",     # Prorate remaining days in the cycle
    "daily_standard_hours": "9.6",      # Standard hours per work day (48h / 5 workdays excluding Fri & Sun)
    "auto_week_off_days": "4,6",        # Friday (4) and Sunday (6) are automatic "WO" if no manual shift logged
    "google_sheet_id": DEFAULT_GOOGLE_SHEET_ID,
    "google_sheets_webhook_url": "",    # Google Apps Script Webhook endpoint if deployed
    "company_name": "Inventory Attendance Management Portal",
    "default_department": "Inventory"
}
