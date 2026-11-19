import datetime
import requests
from pathlib import Path
from fastapi import APIRouter, HTTPException
from backend.database import get_db, get_setting
from backend.config import DEFAULT_GOOGLE_SHEET_ID
from backend.seed_data import format_whatsapp

router = APIRouter(prefix="/api/sheets", tags=["Google Sheets"])

# Read canonical google_apps_script.js file
APPS_SCRIPT_PATH = Path(__file__).resolve().parent.parent.parent / "google_apps_script.js"

@router.get("/config")
def get_sheets_config():
    sheet_id = get_setting("google_sheet_id", DEFAULT_GOOGLE_SHEET_ID)
    webhook_url = get_setting("google_sheets_webhook_url", "")
    sheet_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit?usp=sharing"

    with get_db() as conn:
        logs = conn.execute("SELECT * FROM sync_logs ORDER BY id DESC LIMIT 10").fetchall()

    return {
        "sheet_id": sheet_id,
        "sheet_url": sheet_url,
        "webhook_url": webhook_url,
        "sync_logs": logs
    }

@router.get("/apps-script-code")
def get_apps_script_code():
    script_text = ""
    if APPS_SCRIPT_PATH.exists():
        script_text = APPS_SCRIPT_PATH.read_text(encoding="utf-8")
    
    return {
        "script": script_text,
        "instructions": [
            "1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y",
            "2. Ensure you have tabs: 'Staff_data', 'Locations', and 'Attendance_data'.",
            "3. Click 'Extensions' > 'Apps Script' in the top menu.",
            "4. Delete existing code, paste the contents of google_apps_script.js, and click Save.",
            "5. Click 'Deploy' > 'New deployment'.",
            "6. Select type 'Web app', Execute as: 'Me', Who has access: 'Anyone'.",
            "7. Copy the generated Web App URL and paste it into static/js/config.js (or into the Connect Sheet modal)!"
        ]
    }

@router.post("/sync")
def trigger_sync():
    """
    Synchronizes staff and locations from Google Sheets Webhook.
    """
    now_str = datetime.datetime.now().isoformat()
    webhook_url = get_setting("google_sheets_webhook_url", "").strip()

    synced_staff = 0
    synced_locs = 0
    message = ""

    if webhook_url:
        try:
            resp = requests.get(f"{webhook_url}?action=get_all", timeout=15)
            if resp.status_code == 200:
                data = resp.json()
                with get_db() as conn:
                    # Sync locations
                    if "locations" in data and isinstance(data["locations"], list):
                        for l in data["locations"]:
                            conn.execute("""
                                INSERT INTO locations (branch, emr, location, created_at)
                                VALUES (?, ?, ?, ?)
                                ON CONFLICT(branch) DO UPDATE SET emr = excluded.emr, location = excluded.location
                            """, (l.get("branch", "").strip(), l.get("emr", "").strip(), l.get("location", "").strip(), now_str))
                            synced_locs += 1

                    # Sync staff
                    if "staff" in data and isinstance(data["staff"], list):
                        dept = conn.execute("SELECT id FROM departments WHERE name = 'Inventory'").fetchone()
                        dept_id = dept["id"] if dept else 1

                        for s in data["staff"]:
                            wa = format_whatsapp(s.get("whatsapp", ""))
                            code = str(s.get("employee_code", "")).strip()
                            name = str(s.get("name", "")).strip()
                            if not name:
                                continue

                            existing = conn.execute("SELECT id FROM staff WHERE employee_code = ? OR name = ?", (code, name)).fetchone()

                            if existing:
                                conn.execute("""
                                    UPDATE staff SET employee_code = ?, designation = ?, allocated_to = ?, whatsapp = ?, updated_at = ?
                                    WHERE id = ?
                                """, (code, s.get("designation", "Staff"), s.get("allocated_to", "HEAD OFFICE"), wa, now_str, existing["id"]))
                            else:
                                conn.execute("""
                                    INSERT INTO staff (sl_no, employee_code, name, designation, department_id, allocated_to, whatsapp, is_active, created_at, updated_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                                """, (s.get("sl_no"), code, name, s.get("designation", "Staff"), dept_id, s.get("allocated_to", "HEAD OFFICE"), wa, now_str, now_str))
                            synced_staff += 1

                    message = f"Synced {synced_staff} staff and {synced_locs} locations from Google Sheets Webhook."
                    status = "SUCCESS"
            else:
                message = f"Webhook returned HTTP {resp.status_code}"
                status = "FAILED"
        except Exception as e:
            message = f"Webhook error: {str(e)}"
            status = "FAILED"
    else:
        message = "No Google Sheets Webhook URL configured. Please deploy google_apps_script.js and set your Web App URL."
        status = "UNCONFIGURED"

    with get_db() as conn:
        conn.execute("""
            INSERT INTO sync_logs (synced_at, direction, status, records_count, details)
            VALUES (?, 'PULL', ?, ?, ?)
        """, (now_str, status, synced_staff + synced_locs, message))

    return {
        "status": status,
        "message": message,
        "synced_staff": synced_staff,
        "synced_locations": synced_locs,
        "timestamp": now_str
    }
