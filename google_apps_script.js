/**
 * ======================================================================
 * STAFF ATTENDANCE SYSTEM — GOOGLE APPS SCRIPT WEB APP BACKEND (v3.1)
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
 * - Duplicate Prevention: Identical entries are not duplicated.
 * ----------------------------------------------------------------------
 */

function formatDateSafe(val, tz) {
  if (!val) return "";
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return "";
    var y = val.getFullYear();
    var m = ("0" + (val.getMonth() + 1)).slice(-2);
    var d = ("0" + val.getDate()).slice(-2);
    return y + "-" + m + "-" + d;
  }
  var str = val.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.substring(0, 10);
  }
  var dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    var dd = ("0" + dmyMatch[1]).slice(-2);
    var mm = ("0" + dmyMatch[2]).slice(-2);
    return dmyMatch[3] + "-" + mm + "-" + dd;
  }
  return str;
}

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = Session.getScriptTimeZone();
  var params = (e && e.parameter) ? e.parameter : {};
  var action = params.action || "get_all";

  // Support attendance logging via GET to bypass 302 POST body loss
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
      if (!row[2] || row[2].toString().trim() === "") continue;
      
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

    // 2. Fetch Locations from 'Locations' sheet under the header 'Branch'
    var locSheet = ss.getSheetByName("Locations") || ss.getSheetByName("locations") || ss.getSheetByName("Location") || ss.getSheetByName("Branches");
    var locList = [];
    if (locSheet) {
      var locData = locSheet.getDataRange().getValues();
      if (locData.length > 0) {
        var locHeaders = locData[0];
        var branchCol = 0;
        var emrCol = 1;
        var locCol = 2;

        for (var c = 0; c < locHeaders.length; c++) {
          var h = locHeaders[c] ? locHeaders[c].toString().trim().toLowerCase() : "";
          if (h === "branch" || h === "branch name" || h === "branches") {
            branchCol = c;
          } else if (h === "emr" || h === "emirate") {
            emrCol = c;
          } else if (h === "location" || h === "city" || h === "area") {
            locCol = c;
          }
        }

        for (var k = 1; k < locData.length; k++) {
          var lrow = locData[k];
          var bName = lrow[branchCol] ? lrow[branchCol].toString().trim() : "";
          if (!bName) continue;
          locList.push({
            id: k,
            branch: bName,
            emr: (emrCol < lrow.length && lrow[emrCol]) ? lrow[emrCol].toString().trim() : "",
            location: (locCol < lrow.length && lrow[locCol]) ? lrow[locCol].toString().trim() : ""
          });
        }
      }
    }

    // 3. Fetch Attendance from 'Attendance_data'
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
  var newBranch = payload.location ? payload.location.toString().trim() : "";
  var newStatus = payload.status ? payload.status.toString().trim() : "Present";
  var newCheckIn = payload.check_in ? payload.check_in.toString().trim() : "";
  var newCheckOut = payload.check_out ? payload.check_out.toString().trim() : "";
  var newHours = parseFloat(payload.total_hours) || 0.0;
  var newNotes = payload.notes ? payload.notes.toString().trim() : "";

  // Check duplicate on same date for same employee
  var existingData = targetSheet.getDataRange().getValues();
  var existingRowIndex = -1;
  var existingRowData = null;

  for (var r = 1; r < existingData.length; r++) {
    var rFormatted = formatDateSafe(existingData[r][1], tz);
    var rCode = existingData[r][2] ? existingData[r][2].toString().trim() : "";
    var rName = existingData[r][3] ? existingData[r][3].toString().trim() : "";

    var dateMatch = (rFormatted === dateStr);
    var codeMatch = (empCode !== "" && rCode !== "" && rCode === empCode);
    var nameMatch = (empName !== "" && rName !== "" && rName.toLowerCase() === empName.toLowerCase());

    if (dateMatch && (codeMatch || nameMatch)) {
      existingRowIndex = r + 1; // 1-based index in Google Sheets
      existingRowData = existingData[r];
      break;
    }
  }

  var nowTimestamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss");

  if (existingRowIndex > 0) {
    var oldBranch = existingRowData[4] ? existingRowData[4].toString().trim() : "";
    var oldStatus = existingRowData[5] ? existingRowData[5].toString().trim() : "";
    var oldCheckIn = existingRowData[6] ? existingRowData[6].toString().trim() : "";
    var oldCheckOut = existingRowData[7] ? existingRowData[7].toString().trim() : "";
    var oldHours = parseFloat(existingRowData[8]) || 0.0;
    var oldNotes = existingRowData[9] ? existingRowData[9].toString().trim() : "";

    var isIdentical = (oldBranch.toUpperCase() === newBranch.toUpperCase() &&
                       oldStatus.toUpperCase() === newStatus.toUpperCase() &&
                       oldCheckIn === newCheckIn &&
                       oldCheckOut === newCheckOut &&
                       Math.abs(oldHours - newHours) < 0.01 &&
                       oldNotes === newNotes);

    if (isIdentical) {
      return createJsonResponse({
        status: "success",
        action: "unchanged",
        message: "Attendance entry already recorded with identical details on " + dateStr
      });
    }

    if (!allowUpdate) {
      return createJsonResponse({
        status: "duplicate",
        message: "Attendance entry already exists for " + empName + " (" + empCode + ") on " + dateStr + " (" + oldStatus + ", " + oldHours + "h). Do you want to update it?"
      });
    }

    // Update existing row
    targetSheet.getRange(existingRowIndex, 1, 1, 10).setValues([[
      nowTimestamp,
      dateStr,
      empCode,
      empName,
      newBranch,
      newStatus,
      newCheckIn,
      newCheckOut,
      newHours,
      newNotes
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
      newBranch,
      newStatus,
      newCheckIn,
      newCheckOut,
      newHours,
      newNotes
    ]);

    pruneOldAttendanceRecords(targetSheet, tz);

    return createJsonResponse({
      status: "success",
      action: "added",
      message: "Added attendance for " + empName + " on " + dateStr
    });
  }
}

function pruneOldAttendanceRecords(sheet, tz) {
  try {
    var data = sheet.getDataRange().getValues();
    if (data.length <= 2) return;

    var cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 365);

    var rowsToDelete = [];
    for (var i = 1; i < data.length; i++) {
      var dVal = data[i][1];
      if (!dVal) continue;
      var dFormatted = formatDateSafe(dVal, tz);
      if (dFormatted && dFormatted.indexOf("-") > -1) {
        var parts = dFormatted.split("-");
        var rowDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (rowDate < cutoffDate) {
          rowsToDelete.push(i + 1);
        }
      }
    }

    for (var j = rowsToDelete.length - 1; j >= 0; j--) {
      sheet.deleteRow(rowsToDelete[j]);
    }
  } catch (e) {
  }
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function dailyMaintenance() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = ss.getSheetByName("Attendance_data");
  if (targetSheet) {
    pruneOldAttendanceRecords(targetSheet, Session.getScriptTimeZone());
  }
}
