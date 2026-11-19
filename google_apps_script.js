/**
 * ======================================================================
 * STAFF ATTENDANCE SYSTEM — GOOGLE APPS SCRIPT WEB APP BACKEND (v3.0)
 * ======================================================================
 * 
 * SPREADSHEET URL:
 * https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y/edit?usp=sharing
 * 
 * SHEETS USED:
 * 1. 'Staff_data'      -> Sl. No. | Employee Code | Employee Name | Designation | Allocated to | Whatsapp | IMAGE | Gmail
 * 2. 'Locations'       -> Branch | Emr | Location
 * 3. 'Attendance_data' -> Timestamp | Date | Employee Code | Employee Name | Branch | Status | Start Time | End Time | Total Hours | Notes
 * 
 * ----------------------------------------------------------------------
 * WEEK & SHIFT RULES:
 * - A week runs Monday to Sunday (ISO calendar week).
 * - Weekly target: 48 Hours.
 * - Standard Week Offs (WO): THURSDAY and SATURDAY.
 * - Cutoff cycle: 20th of the month to 19th of the next month.
 * - 1-Year Rolling Retention: Records older than 365 days are pruned.
 * ----------------------------------------------------------------------
 * DEPLOYMENT INSTRUCTIONS:
 * 1. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y/edit?usp=sharing
 * 2. In Google Sheets top menu, click: Extensions > Apps Script
 * 3. Delete any code there, paste this entire file, and click Save (disk icon).
 * 4. Click 'Deploy' (top right) > 'New deployment'.
 * 5. Click the gear icon next to 'Select type' and choose 'Web app'.
 * 6. Set Description: "Attendance API v3"
 *    Set 'Execute as': "Me" (your Google account)
 *    Set 'Who has access': "Anyone"  <-- CRITICAL for GitHub Pages access!
 * 7. Click 'Deploy', authorize permissions if Google prompts you, and copy the Web App URL.
 * 8. Open 'static/js/config.js' in your repository and paste that URL:
 *    window.APP_CONFIG.GOOGLE_SCRIPT_URL = "YOUR_COPIED_URL";
 * ======================================================================
 */

function formatDateSafe(val, tz) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    try {
      return Utilities.formatDate(val, tz || Session.getScriptTimeZone(), "yyyy-MM-dd");
    } catch(e) {
      var y = val.getFullYear();
      var m = ("0" + (val.getMonth() + 1)).slice(-2);
      var d = ("0" + val.getDate()).slice(-2);
      return y + "-" + m + "-" + d;
    }
  }
  var str = val.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }
  return str;
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = Session.getScriptTimeZone();
  var params = (e && e.parameter) ? e.parameter : {};
  var action = params.action || "get_all";

  // Support attendance logging via GET to bypass restrictive corporate firewalls and 302 POST body loss
  if (action === "log_attendance") {
    try {
      var payloadStr = params.payload || params.data;
      if (!payloadStr) {
        return createJsonResponse({ status: "error", message: "Missing payload parameter" });
      }
      var payload = (typeof payloadStr === "string") ? JSON.parse(decodeURIComponent(payloadStr)) : payloadStr;
      return handleLogAttendance(ss, payload, tz);
    } catch (err) {
      return createJsonResponse({ status: "error", message: "GET log error: " + err.toString() });
    }
  }

  try {
    // 1. Fetch Staff Data from 'Staff_data'
    // Header: Sl. No.(0) | Employee Code(1) | Employee Name(2) | Designation(3) | Allocated to(4) | Whatsapp(5) | IMAGE(6) | Gmail(7)
    var staffSheet = ss.getSheetByName("Staff_data") || ss.getSheets()[0];
    var staffData = staffSheet.getDataRange().getValues();
    var staffList = [];

    for (var i = 1; i < staffData.length; i++) {
      var row = staffData[i];
      if (!row[2] || row[2].toString().trim() === "") continue; // Needs Employee Name
      
      var slNo = row[0] ? parseInt(row[0], 10) : i;
      var empCode = row[1] ? row[1].toString().trim() : ("EMP-" + i);
      var empName = row[2].toString().trim();
      var designation = row[3] ? row[3].toString().trim() : "Staff";
      var allocatedTo = row[4] ? row[4].toString().trim().toUpperCase() : "HEAD OFFICE";
      var whatsapp = row[5] ? row[5].toString().trim() : "";
      var imageUrl = row[6] ? row[6].toString().trim() : "";
      var gmail = row[7] ? row[7].toString().trim().toLowerCase() : "";

      if (!imageUrl) {
        imageUrl = "https://api.dicebear.com/7.x/initials/svg?seed=" + encodeURIComponent(empName) + "&backgroundColor=0284c7,0d9488,4f46e5&textColor=ffffff";
      }

      staffList.push({
        id: i,
        sl_no: slNo,
        employee_code: empCode,
        name: empName,
        designation: designation,
        allocated_to: allocatedTo,
        whatsapp: whatsapp,
        image_url: imageUrl,
        gmail: gmail
      });
    }

    // 2. Fetch Locations from 'Locations' (Branch(0) | Emr(1) | Location(2))
    var locSheet = ss.getSheetByName("Locations");
    var locList = [];
    if (locSheet) {
      var locData = locSheet.getDataRange().getValues();
      for (var k = 1; k < locData.length; k++) {
        var lrow = locData[k];
        if (!lrow[0] || lrow[0].toString().trim() === "") continue;
        locList.push({
          id: k,
          branch: lrow[0].toString().trim(),
          emr: lrow[1] ? lrow[1].toString().trim() : "",
          location: lrow[2] ? lrow[2].toString().trim() : ""
        });
      }
    }

    // 3. Fetch Attendance from 'Attendance_data'
    // Header: Timestamp(0) | Date(1) | Employee Code(2) | Employee Name(3) | Branch(4) | Status(5) | Start Time(6) | End Time(7) | Total Hours(8) | Notes(9)
    var attSheet = ss.getSheetByName("Attendance_data");
    var logsList = [];
    if (attSheet) {
      var attData = attSheet.getDataRange().getValues();
      for (var a = 1; a < attData.length; a++) {
        var aRow = attData[a];
        if (!aRow[1] || aRow[1].toString().trim() === "") continue;
        
        var dateFormatted = formatDateSafe(aRow[1], tz);

        logsList.push({
          id: a,
          timestamp: aRow[0] ? aRow[0].toString() : "",
          date: dateFormatted,
          employee_code: aRow[2] ? aRow[2].toString().trim() : "",
          name: aRow[3] ? aRow[3].toString().trim() : "",
          location: aRow[4] ? aRow[4].toString().trim() : "",
          status: aRow[5] ? aRow[5].toString().trim() : "Present",
          check_in: aRow[6] ? aRow[6].toString().trim() : "",
          check_out: aRow[7] ? aRow[7].toString().trim() : "",
          total_hours: aRow[8] ? parseFloat(aRow[8]) : 0.0,
          notes: aRow[9] ? aRow[9].toString().trim() : ""
        });
      }
    }

    return createJsonResponse({
      status: "success",
      sheet_name: ss.getName(),
      staff_count: staffList.length,
      staff: staffList,
      locations_count: locList.length,
      locations: locList,
      attendance_count: logsList.length,
      attendance: logsList
    });

  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: err.toString()
    });
  }
}

function doPost(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = Session.getScriptTimeZone();

  try {
    var payload = null;
    if (e && e.postData && e.postData.contents) {
      try {
        payload = JSON.parse(e.postData.contents);
      } catch (parseErr) {
        payload = e.parameter;
      }
    } else if (e && e.parameter) {
      var pStr = e.parameter.payload || e.parameter.data;
      if (pStr) {
        payload = JSON.parse(decodeURIComponent(pStr));
      } else {
        payload = e.parameter;
      }
    }

    if (!payload) {
      return createJsonResponse({ status: "error", message: "No payload provided in POST" });
    }

    var action = payload.action || "log_attendance";

    if (action === "log_attendance") {
      return handleLogAttendance(ss, payload, tz);
    }

    return createJsonResponse({ status: "unsupported_action" });

  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: err.toString()
    });
  }
}

function handleLogAttendance(ss, payload, tz) {
  var targetSheet = ss.getSheetByName("Attendance_data");
  if (!targetSheet) {
    targetSheet = ss.insertSheet("Attendance_data");
    targetSheet.appendRow([
      "Timestamp", "Date", "Employee Code", "Employee Name", "Branch",
      "Status", "Start Time", "End Time", "Total Hours", "Notes"
    ]);
    targetSheet.getRange("A1:J1").setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF");
  }

  var dateStr = payload.date ? payload.date.toString().trim() : "";
  var empCode = payload.employee_code ? payload.employee_code.toString().trim() : "";
  var empName = payload.name ? payload.name.toString().trim() : "";
  var allowUpdate = payload.allow_update === true;

  // Check duplicate on same date for same employee
  var existingData = targetSheet.getDataRange().getValues();
  var existingRowIndex = -1;

  for (var r = 1; r < existingData.length; r++) {
    var rFormatted = formatDateSafe(existingData[r][1], tz);
    var rCode = existingData[r][2] ? existingData[r][2].toString().trim() : "";
    var rName = existingData[r][3] ? existingData[r][3].toString().trim() : "";

    if (rFormatted === dateStr && (rCode === empCode || (empCode === "" && rName === empName))) {
      existingRowIndex = r + 1; // 1-based index in Google Sheets
      break;
    }
  }

  var nowTimestamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");

  if (existingRowIndex > 0 && !allowUpdate) {
    return createJsonResponse({
      status: "duplicate",
      message: "Attendance entry already exists for " + empName + " (" + empCode + ") on " + dateStr
    });
  }

  if (existingRowIndex > 0 && allowUpdate) {
    // Update existing row
    targetSheet.getRange(existingRowIndex, 1, 1, 10).setValues([[
      nowTimestamp,
      dateStr,
      empCode,
      empName,
      payload.location || "",
      payload.status || "Present",
      payload.check_in || "",
      payload.check_out || "",
      parseFloat(payload.total_hours) || 0.0,
      payload.notes || ""
    ]]);

    return createJsonResponse({
      status: "success",
      action: "updated",
      message: "Updated attendance for " + empName + " on " + dateStr
    });
  } else {
    // Append new row
    targetSheet.appendRow([
      nowTimestamp,
      dateStr,
      empCode,
      empName,
      payload.location || "",
      payload.status || "Present",
      payload.check_in || "",
      payload.check_out || "",
      parseFloat(payload.total_hours) || 0.0,
      payload.notes || ""
    ]);

    // Apply 1-Year Retention Policy (prunes records older than 365 days)
    pruneOldAttendanceRecords(targetSheet, tz);

    return createJsonResponse({
      status: "success",
      action: "added",
      message: "Added attendance for " + empName + " on " + dateStr
    });
  }
}

/**
 * 1-Year Rolling Retention Policy:
 * Scans 'Attendance_data' and removes records older than 365 days.
 * Keeps exactly the past 1 year of attendance history clean and fast.
 */
function pruneOldAttendanceRecords(sheet, tz) {
  try {
    var data = sheet.getDataRange().getValues();
    if (data.length <= 2) return;

    var cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 365); // 365 days ago

    var rowsToDelete = [];
    for (var i = 1; i < data.length; i++) {
      var dVal = data[i][1];
      if (!dVal) continue;
      var dFormatted = formatDateSafe(dVal, tz);
      if (dFormatted && dFormatted.indexOf("-") > -1) {
        var parts = dFormatted.split("-");
        var rowDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (rowDate < cutoffDate) {
          rowsToDelete.push(i + 1); // 1-based index
        }
      }
    }

    // Delete from bottom up to preserve row indices
    for (var j = rowsToDelete.length - 1; j >= 0; j--) {
      sheet.deleteRow(rowsToDelete[j]);
    }
  } catch (e) {
    // Non-fatal error during pruning
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Optional Recurring Daily Trigger
 * Can be scheduled via Apps Script Triggers to prune old records daily at midnight.
 */
function dailyMaintenance() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = ss.getSheetByName("Attendance_data");
  if (targetSheet) {
    pruneOldAttendanceRecords(targetSheet, Session.getScriptTimeZone());
  }
}
