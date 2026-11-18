/**
 * ======================================================================
 * STAFF ATTENDANCE SYSTEM - GOOGLE APPS SCRIPT WEB APP BACKEND
 * ======================================================================
 * 
 * SPREADSHEET URL:
 * https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y/edit?usp=sharing
 * 
 * SHEETS USED:
 * 1. 'Staff_data'    -> Headers: Sl. No. | Employee Code | Employee Name | Designation | Allocated to | Whatsapp | IMAGE
 * 2. 'Locations'     -> Headers: Branch | Emr | Location
 * 3. 'Attendance_Logs' -> Auto-created if missing. Headers: Timestamp | Date | Employee Code | Employee Name | Branch | Status | Start Time | End Time | Total Hours | Notes
 * 
 * ----------------------------------------------------------------------
 * DEPLOYMENT INSTRUCTIONS (Takes 60 seconds):
 * 1. In your Google Sheet, click top menu: Extensions > Apps Script
 * 2. Delete any existing code, and paste this entire file.
 * 3. Click 'Save' (disk icon) and name the project 'Attendance API'.
 * 4. Click 'Deploy' (top right) > 'New deployment'.
 * 5. Click the gear icon next to 'Select type' and choose 'Web app'.
 * 6. Set Description: "Attendance Web App"
 *    Set 'Execute as': "Me" (your email)
 *    Set 'Who has access': "Anyone" (allows your GitHub Pages frontend to call it securely)
 * 7. Click 'Deploy' and authorize access when prompted.
 * 8. Copy the generated 'Web app URL' (looks like: https://script.google.com/macros/s/.../exec).
 * 9. Paste this URL into the Attendance App 'Settings > Google Sheet Web App URL' and click Save!
 * ======================================================================
 */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "get_all";
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    // 1. Fetch Staff Data
    var staffSheet = ss.getSheetByName("Staff_data") || ss.getSheets()[0];
    var staffData = staffSheet.getDataRange().getValues();
    var staffList = [];

    // Skip header row
    for (var i = 1; i < staffData.length; i++) {
      var row = staffData[i];
      if (!row[2] || row[2].toString().trim() === "") continue; // Needs Employee Name
      
      var slNo = row[0] ? parseInt(row[0]) : i;
      var empCode = row[1] ? row[1].toString().trim() : ("INV-" + String(i).padStart(3, '0'));
      var empName = row[2].toString().trim();
      var designation = row[3] ? row[3].toString().trim() : "Inventory Helper";
      var allocatedTo = row[4] ? row[4].toString().trim().toUpperCase() : "HEAD OFFICE";
      var whatsapp = row[5] ? row[5].toString().trim() : "";
      var imageUrl = row[6] ? row[6].toString().trim() : "";
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
        image_url: imageUrl
      });
    }

    // 2. Fetch Locations Data
    var locSheet = ss.getSheetByName("Locations");
    var locList = [];
    if (locSheet) {
      var locData = locSheet.getDataRange().getValues();
      for (var k = 1; k < locData.length; k++) {
        var lrow = locData[k];
        if (!lrow[0] || lrow[0].toString().trim() === "") continue;
        locList.push({
          id: k,
          branch: lrow[0].toString().trim().toUpperCase(),
          emr: lrow[1] ? lrow[1].toString().trim() : "",
          location: lrow[2] ? lrow[2].toString().trim() : ""
        });
      }
    } else {
      // Default fallback branches
      locList = [
        { id: 1, branch: "HEAD OFFICE", emr: "Dubai", location: "Head Office - Dubai" },
        { id: 2, branch: "DUBAI", emr: "Dubai", location: "Dubai Central Warehouse" },
        { id: 3, branch: "ABU DHABI", emr: "Abu Dhabi", location: "Abu Dhabi Branch" },
        { id: 4, branch: "RAK", emr: "Ras Al Khaimah", location: "RAK Depot" },
        { id: 5, branch: "FUJAIRAH", emr: "Fujairah", location: "Fujairah Distribution" },
        { id: 6, branch: "SHARJAH", emr: "Sharjah", location: "Sharjah Logistics Center" }
      ];
    }

    // 3. Fetch Attendance Logs
    var attSheet = ss.getSheetByName("Attendance_Logs");
    var logsList = [];
    if (attSheet) {
      var attData = attSheet.getDataRange().getValues();
      for (var a = 1; a < attData.length; a++) {
        var aRow = attData[a];
        if (!aRow[1] || aRow[1].toString().trim() === "") continue; // Date is at index 1
        
        var dateFormatted = "";
        if (aRow[1] instanceof Date) {
          dateFormatted = Utilities.formatDate(aRow[1], Session.getScriptTimeZone(), "yyyy-MM-dd");
        } else {
          dateFormatted = aRow[1].toString().trim();
        }

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

    var result = {
      status: "success",
      sheet_name: ss.getName(),
      staff_count: staffList.length,
      staff: staffList,
      locations_count: locList.length,
      locations: locList,
      attendance_count: logsList.length,
      attendance: logsList
    };

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var contents = e.postData.contents;
    var payload = JSON.parse(contents);
    var action = payload.action || "log_attendance";
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === "log_attendance") {
      var targetSheet = ss.getSheetByName("Attendance_Logs");
      if (!targetSheet) {
        targetSheet = ss.insertSheet("Attendance_Logs");
        targetSheet.appendRow([
          "Timestamp", "Date", "Employee Code", "Employee Name", "Branch",
          "Status", "Start Time", "End Time", "Total Hours", "Notes"
        ]);
        targetSheet.getRange("A1:J1").setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF");
      }

      var dateStr = payload.date ? payload.date.toString().trim() : "";
      var empCode = payload.employee_code ? payload.employee_code.toString().trim() : "";
      var allowUpdate = payload.allow_update === true;

      // Check duplicate on same date for same employee
      var existingData = targetSheet.getDataRange().getValues();
      var existingRowIndex = -1;

      for (var r = 1; r < existingData.length; r++) {
        var rDate = existingData[r][1];
        var rFormatted = (rDate instanceof Date) ? Utilities.formatDate(rDate, Session.getScriptTimeZone(), "yyyy-MM-dd") : rDate.toString().trim();
        var rCode = existingData[r][2] ? existingData[r][2].toString().trim() : "";

        if (rFormatted === dateStr && rCode === empCode) {
          existingRowIndex = r + 1; // 1-based index
          break;
        }
      }

      var nowTimestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

      if (existingRowIndex > 0 && !allowUpdate) {
        return ContentService.createTextOutput(JSON.stringify({
          status: "duplicate",
          message: "Attendance entry already exists for " + payload.name + " (" + empCode + ") on " + dateStr
        })).setMimeType(ContentService.MimeType.JSON);
      }

      if (existingRowIndex > 0 && allowUpdate) {
        // Update existing row
        targetSheet.getRange(existingRowIndex, 1, 1, 10).setValues([[
          nowTimestamp,
          dateStr,
          empCode,
          payload.name || "",
          payload.location || "",
          payload.status || "Present",
          payload.check_in || "",
          payload.check_out || "",
          parseFloat(payload.total_hours) || 0.0,
          payload.notes || ""
        ]]);

        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          action: "updated",
          message: "Updated attendance for " + payload.name + " on " + dateStr
        })).setMimeType(ContentService.MimeType.JSON);
      } else {
        // Append new row
        targetSheet.appendRow([
          nowTimestamp,
          dateStr,
          empCode,
          payload.name || "",
          payload.location || "",
          payload.status || "Present",
          payload.check_in || "",
          payload.check_out || "",
          parseFloat(payload.total_hours) || 0.0,
          payload.notes || ""
        ]);

        return ContentService.createTextOutput(JSON.stringify({
          status: "success",
          action: "added",
          message: "Added attendance for " + payload.name + " on " + dateStr
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      status: "unsupported_action"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
