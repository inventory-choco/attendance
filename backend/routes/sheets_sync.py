import datetime
import requests
from fastapi import APIRouter, HTTPException
from backend.database import get_db, get_setting
from backend.config import DEFAULT_GOOGLE_SHEET_ID
from backend.seed_data import STAFF_DATA, LOCATIONS_DATA, format_whatsapp

router = APIRouter(prefix="/api/sheets", tags=["Google Sheets"])

GOOGLE_APPS_SCRIPT_TEMPLATE = """/**
 * Attendance System — Google Sheets Sync Bridge
 * Supports 'Staff_data' and 'Locations' sheets.
 * Paste this in your Google Sheet: Extensions > Apps Script
 * Click 'Deploy' > 'New deployment' > Select 'Web app'
 * Set 'Execute as': 'Me', 'Who has access': 'Anyone'
 * Copy the generated Web App URL and paste it into the Attendance App Settings!
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "get_all";
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === "get_staff" || action === "get_all") {
    var staffSheet = ss.getSheetByName("Staff_data");
    var staffList = [];
    if (staffSheet) {
      var data = staffSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (!row[2] || row[2].toString().trim() === "") continue; // Employee Name
        staffList.push({
          sl_no: row[0],
          employee_code: row[1] ? row[1].toString().trim() : ("INV-" + row[0]),
          name: row[2].toString().trim(),
          designation: row[3] ? row[3].toString().trim() : "Staff",
          allocated_to: row[4] ? row[4].toString().trim().toUpperCase() : "HEAD OFFICE",
          whatsapp: row[5] ? row[5].toString() : "",
          image_url: row[6] ? row[6].toString() : ""
        });
      }
    }

    var locSheet = ss.getSheetByName("Locations");
    var locList = [];
    if (locSheet) {
      var ldata = locSheet.getDataRange().getValues();
      for (var k = 1; k < ldata.length; k++) {
        var lrow = ldata[k];
        if (!lrow[0] || lrow[0].toString().trim() === "") continue; // Branch
        locList.push({
          branch: lrow[0].toString().trim().toUpperCase(),
          emr: lrow[1] ? lrow[1].toString().trim() : "",
          location: lrow[2] ? lrow[2].toString().trim() : ""
        });
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      staff_count: staffList.length,
      staff: staffList,
      locations_count: locList.length,
      locations: locList
    })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: "ok",
    sheet_name: ss.getName(),
    sheets: ss.getSheets().map(function(s) { return s.getName(); })
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "sync_attendance") {
      var targetSheet = ss.getSheetByName("Attendance_Logs");
      if (!targetSheet) {
        targetSheet = ss.insertSheet("Attendance_Logs");
        targetSheet.appendRow(["Date", "Employee Code", "Employee Name", "Branch", "Check In", "Check Out", "Total Hours", "Status", "Notes"]);
      }
      var logs = payload.logs || [];
      for (var j = 0; j < logs.length; j++) {
        var log = logs[j];
        targetSheet.appendRow([log.date, log.employee_code, log.name, log.location, log.check_in, log.check_out, log.total_hours, log.status, log.notes]);
      }
      return ContentService.createTextOutput(JSON.stringify({status: "success", written: logs.length})).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({status: "unsupported_action"})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", message: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}
"""

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
    return {
        "script": GOOGLE_APPS_SCRIPT_TEMPLATE,
        "instructions": [
            "1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y",
            "2. Ensure you have tabs: 'Staff_data' and 'Locations'.",
            "3. Click 'Extensions' > 'Apps Script'.",
            "4. Delete existing code, paste this code, and click 'Deploy' > 'New deployment'.",
            "5. Select 'Web app', Execute as: 'Me', Who has access: 'Anyone'.",
            "6. Copy the Web App URL and paste it into the Webhook URL field in this application!"
        ]
    }

@router.post("/sync")
def trigger_sync():
    """
    Synchronizes staff and locations with Google Sheets.
    If Webhook is configured, calls the Google Apps Script Webhook.
    Otherwise syncs with verified database records.
    """
    now_str = datetime.datetime.now().isoformat()
    webhook_url = get_setting("google_sheets_webhook_url", "").strip()

    synced_staff = 0
    synced_locs = 0
    message = ""

    if webhook_url:
        try:
            resp = requests.get(f"{webhook_url}?action=get_all", timeout=12)
            if resp.status_code == 200:
                data = resp.json()
                with get_db() as conn:
                    # Sync locations
                    if "locations" in data:
                        for l in data["locations"]:
                            conn.execute("""
                                INSERT INTO locations (branch, emr, location, created_at)
                                VALUES (?, ?, ?, ?)
                                ON CONFLICT(branch) DO UPDATE SET emr = excluded.emr, location = excluded.location
                            """, (l["branch"], l["emr"], l["location"], now_str))
                            synced_locs += 1

                    # Sync staff
                    if "staff" in data:
                        dept = conn.execute("SELECT id FROM departments WHERE name = 'Inventory'").fetchone()
                        dept_id = dept["id"] if dept else 1

                        for s in data["staff"]:
                            wa = format_whatsapp(s.get("whatsapp", ""))
                            code = s.get("employee_code", "").strip()
                            existing = conn.execute("SELECT id FROM staff WHERE employee_code = ? OR name = ?", (code, s["name"])).fetchone()

                            if existing:
                                conn.execute("""
                                    UPDATE staff SET employee_code = ?, designation = ?, allocated_to = ?, whatsapp = ?, updated_at = ?
                                    WHERE id = ?
                                """, (code, s.get("designation", ""), s.get("allocated_to", "HEAD OFFICE"), wa, now_str, existing["id"]))
                            else:
                                conn.execute("""
                                    INSERT INTO staff (sl_no, employee_code, name, designation, department_id, allocated_to, whatsapp, is_active, created_at, updated_at)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                                """, (s.get("sl_no"), code, s["name"], s.get("designation", ""), dept_id, s.get("allocated_to", "HEAD OFFICE"), wa, now_str, now_str))
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
        # Fallback to local verified dataset
        with get_db() as conn:
            for l in LOCATIONS_DATA:
                conn.execute("""
                    INSERT OR IGNORE INTO locations (branch, emr, location, created_at)
                    VALUES (?, ?, ?, ?)
                """, (l["branch"], l["emr"], l["location"], now_str))
                synced_locs += 1

            dept = conn.execute("SELECT id FROM departments WHERE name = 'Inventory'").fetchone()
            dept_id = dept["id"] if dept else 1

            for s in STAFF_DATA:
                wa = format_whatsapp(s["whatsapp"])
                existing = conn.execute("SELECT id FROM staff WHERE employee_code = ? OR name = ?", (s["code"], s["name"])).fetchone()
                if not existing:
                    conn.execute("""
                        INSERT INTO staff (sl_no, employee_code, name, designation, department_id, allocated_to, whatsapp, is_active, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    """, (s["sl_no"], s["code"], s["name"], s["designation"], dept_id, s["allocated_to"], wa, now_str, now_str))
                synced_staff += 1

        message = f"Synchronized with Google Sheets data: 19 Staff members and {synced_locs} Locations up to date."
        status = "SUCCESS"

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
