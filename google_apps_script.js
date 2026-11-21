/**
 * ======================================================================
 * STAFF ATTENDANCE SYSTEM — GOOGLE APPS SCRIPT WEB APP BACKEND (v4.0)
 * ======================================================================
 * 
 * SPREADSHEET URL:
 * https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y/edit?usp=sharing
 * 
 * SHEETS USED & EXACT COLUMNS:
 * 1. Staff_data:
 *    Sl. No. | Employee Code | Employee Name | Designation | Allocated to | Whatsapp | IMAGE | Gmail | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
 * 
 * 2. User_Allocation:
 *    Employee Code | Employee Name | Allocated to Employee Code | Allocated to Employee Name | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
 * 
 * 3. Schedule:
 *    Branch | Location | Visit Date | Visit Time | Allocated to Staff | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
 * 
 * 4. Users_Data:
 *    UserName | Gmail | Country | Role | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
 * 
 * 5. Roles:
 *    Role | Attendance Entry Form | View Reports & Breakdowns | Download Excel Reports | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
 * 
 * 6. Locations:
 *    Branch | Country | Emr | Location | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
 * 
 * 7. Attendance_data:
 *    Timestamp | Date | Employee Code | Employee Name | Branch | Status | Start Time | End Time | Total Hours | Notes | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
 * ======================================================================
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

function getFormattedAuditDate(tz) {
  var d = new Date();
  try {
    return Utilities.formatDate(d, tz || Session.getScriptTimeZone(), "dd:MM:yy HH:mm:ss");
  } catch(e) {
    var day = ("0" + d.getDate()).slice(-2);
    var mon = ("0" + (d.getMonth() + 1)).slice(-2);
    var yr = d.getFullYear().toString().slice(-2);
    var hh = ("0" + d.getHours()).slice(-2);
    var mm = ("0" + d.getMinutes()).slice(-2);
    var ss = ("0" + d.getSeconds()).slice(-2);
    return day + ":" + mon + ":" + yr + " " + hh + ":" + mm + ":" + ss;
  }
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

  // Support Admin CRUD via GET
  if (action === "admin_crud" || action === "crud") {
    try {
      var crudPayloadStr = params.payload || params.data;
      if (!crudPayloadStr) {
        return createJsonResponse({ status: "error", message: "Missing payload for CRUD" });
      }
      var crudPayload = (typeof crudPayloadStr === "string") ? JSON.parse(decodeURIComponent(crudPayloadStr)) : crudPayloadStr;
      return handleAdminCrud(ss, crudPayload, tz);
    } catch (err) {
      return createJsonResponse({ status: "error", message: "GET CRUD error: " + err.toString() });
    }
  }

  try {
    // 1. Staff_data
    var staffSheet = ss.getSheetByName("Staff_data") || ss.getSheets()[0];
    var staffData = staffSheet ? staffSheet.getDataRange().getValues() : [];
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
      var updatedBy = (row.length > 8 && row[8]) ? row[8].toString().trim() : "";
      var updatedDate = (row.length > 9 && row[9]) ? row[9].toString().trim() : "";

      if (!imageUrl || imageUrl === "CellImage") {
        imageUrl = "https://api.dicebear.com/7.x/initials/svg?seed=" + encodeURIComponent(empName) + "&backgroundColor=0284c7,0d9488,4f46e5&textColor=ffffff";
      }

      staffList.push({
        id: i,
        row_index: i + 1,
        sl_no: slNo,
        employee_code: empCode,
        name: empName,
        designation: designation,
        allocated_to: allocatedTo,
        whatsapp: whatsapp,
        image_url: imageUrl,
        gmail: gmail,
        updated_by_user: updatedBy,
        updated_by_date: updatedDate
      });
    }

    // 2. Users_Data
    // Columns: UserName | Gmail | Country | Role | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
    var usersSheet = ss.getSheetByName("Users_Data") || ss.getSheetByName("users_data") || ss.getSheetByName("Users Data");
    var usersList = [];
    if (usersSheet) {
      var usersData = usersSheet.getDataRange().getValues();
      if (usersData.length > 1) {
        var uHeaders = usersData[0].map(function(h) { return h ? h.toString().toLowerCase().trim() : ""; });
        var colUName = 0;
        var colUGmail = 1;
        var colUCountry = uHeaders.indexOf("country");
        var colURole = uHeaders.indexOf("role");
        var colUUpUser = -1;
        var colUUpDate = -1;
        for (var uhi = 0; uhi < uHeaders.length; uhi++) {
          if (uHeaders[uhi].indexOf("updated by user") !== -1) colUUpUser = uhi;
          if (uHeaders[uhi].indexOf("updated by date") !== -1) colUUpDate = uhi;
        }

        // Adaptive column index fallback
        if (colUCountry === -1 && usersData[0].length >= 4) {
          colUCountry = 2;
          colURole = 3;
          if (colUUpUser === -1) colUUpUser = 4;
          if (colUUpDate === -1) colUUpDate = 5;
        } else if (colURole === -1) {
          colURole = 2;
          if (colUUpUser === -1) colUUpUser = 3;
          if (colUUpDate === -1) colUUpDate = 4;
        }

        for (var u = 1; u < usersData.length; u++) {
          var urow = usersData[u];
          var uName = (colUName !== -1 && urow[colUName]) ? urow[colUName].toString().trim() : "";
          var uGmail = (colUGmail !== -1 && urow[colUGmail]) ? urow[colUGmail].toString().trim().toLowerCase() : "";
          var uCountry = (colUCountry !== -1 && urow[colUCountry]) ? urow[colUCountry].toString().trim().toUpperCase() : "UAE";
          if (uCountry === "OM") uCountry = "OMAN";
          var uRole = (colURole !== -1 && urow[colURole]) ? urow[colURole].toString().trim() : "Data_Entry";
          var uUpdatedBy = (colUUpUser !== -1 && urow[colUUpUser]) ? urow[colUUpUser].toString().trim() : "";
          var uUpdatedDate = (colUUpDate !== -1 && urow[colUUpDate]) ? urow[colUUpDate].toString().trim() : "";

          if (!uName && !uGmail) continue;

          var rLower = uRole.toLowerCase().replace(/[\s\-_]/g, "");
          var roleNorm = "Data_Entry";
          if (rLower === "admin") {
            roleNorm = "Admin";
          } else if (rLower === "reportonly" || rLower === "report" || rLower === "reports") {
            roleNorm = "Report_Only";
          } else {
            roleNorm = "Data_Entry";
          }

          usersList.push({
            id: u,
            row_index: u + 1,
            user_name: uName,
            gmail: uGmail,
            country: uCountry,
            role: roleNorm,
            updated_by_user: uUpdatedBy,
            updated_by_date: uUpdatedDate
          });
        }
      }
    }

    // 3. User_Allocation
    var allocSheet = ss.getSheetByName("User_Allocation") || ss.getSheetByName("user_allocation") || ss.getSheetByName("User Allocation");
    var allocList = [];
    if (allocSheet) {
      var allocData = allocSheet.getDataRange().getValues();
      for (var al = 1; al < allocData.length; al++) {
        var aRow = allocData[al];
        var empCodeAlloc = aRow[0] ? aRow[0].toString().trim() : "";
        var empNameAlloc = aRow[1] ? aRow[1].toString().trim() : "";
        var targetCode = aRow[2] ? aRow[2].toString().trim() : "";
        var targetName = aRow[3] ? aRow[3].toString().trim() : "";
        var aUpdatedBy = (aRow.length > 4 && aRow[4]) ? aRow[4].toString().trim() : "";
        var aUpdatedDate = (aRow.length > 5 && aRow[5]) ? aRow[5].toString().trim() : "";

        if (!empCodeAlloc && !empNameAlloc && !targetCode) continue;

        allocList.push({
          id: al,
          row_index: al + 1,
          employee_code: empCodeAlloc,
          employee_name: empNameAlloc,
          allocated_to_code: targetCode,
          allocated_to_name: targetName,
          updated_by_user: aUpdatedBy,
          updated_by_date: aUpdatedDate
        });
      }
    }

    // 4. Schedule
    var schedSheet = ss.getSheetByName("Schedule") || ss.getSheetByName("schedule");
    var schedList = [];
    if (schedSheet) {
      var schedData = schedSheet.getDataRange().getValues();
      for (var sc = 1; sc < schedData.length; sc++) {
        var sRow = schedData[sc];
        var sBranch = sRow[0] ? sRow[0].toString().trim() : "";
        var sLoc = sRow[1] ? sRow[1].toString().trim() : "";
        var sDate = sRow[2] ? formatDateSafe(sRow[2], tz) : "";
        var sTime = sRow[3] ? sRow[3].toString().trim() : "";
        var sStaff = sRow[4] ? sRow[4].toString().trim() : "";
        var sUpdatedBy = (sRow.length > 5 && sRow[5]) ? sRow[5].toString().trim() : "";
        var sUpdatedDate = (sRow.length > 6 && sRow[6]) ? sRow[6].toString().trim() : "";

        if (!sBranch && !sDate && !sStaff) continue;

        schedList.push({
          id: sc,
          row_index: sc + 1,
          branch: sBranch,
          location: sLoc,
          visit_date: sDate,
          visit_time: sTime,
          allocated_to_staff: sStaff,
          updated_by_user: sUpdatedBy,
          updated_by_date: sUpdatedDate
        });
      }
    }

    // 5. Locations
    // Columns: Branch | Country | Emr | Location | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
    var locSheet = ss.getSheetByName("Locations") || ss.getSheetByName("Location") || ss.getSheetByName("locations") || ss.getSheetByName("location");
    var locList = [];
    if (locSheet) {
      var locData = locSheet.getDataRange().getValues();
      if (locData.length > 1) {
        var lHeaders = locData[0].map(function(h) { return h ? h.toString().toLowerCase().trim() : ""; });
        var colLBranch = 0;
        var colLCountry = lHeaders.indexOf("country");
        var colLEmr = lHeaders.indexOf("emr");
        var colLLoc = lHeaders.indexOf("location");
        var colLUpUser = -1;
        var colLUpDate = -1;
        for (var lhi = 0; lhi < lHeaders.length; lhi++) {
          if (lHeaders[lhi].indexOf("updated by user") !== -1) colLUpUser = lhi;
          if (lHeaders[lhi].indexOf("updated by date") !== -1) colLUpDate = lhi;
        }

        // Adaptive column index fallback
        if (colLCountry === -1 && locData[0].length >= 4) {
          colLCountry = 1;
          colLEmr = 2;
          colLLoc = 3;
          if (colLUpUser === -1) colLUpUser = 4;
          if (colLUpDate === -1) colLUpDate = 5;
        } else if (colLEmr === -1) {
          colLEmr = 1;
          colLLoc = 2;
          if (colLUpUser === -1) colLUpUser = 3;
          if (colLUpDate === -1) colLUpDate = 4;
        }

        for (var k = 1; k < locData.length; k++) {
          var lrow = locData[k];
          var bName = (colLBranch !== -1 && lrow[colLBranch]) ? lrow[colLBranch].toString().trim() : "";
          if (!bName) continue;
          var bCountry = (colLCountry !== -1 && lrow[colLCountry]) ? lrow[colLCountry].toString().trim().toUpperCase() : "UAE";
          if (bCountry === "OM") bCountry = "OMAN";
          var bEmr = (colLEmr !== -1 && lrow[colLEmr]) ? lrow[colLEmr].toString().trim() : "";
          var bLoc = (colLLoc !== -1 && lrow[colLLoc]) ? lrow[colLLoc].toString().trim() : "";
          var bUpUser = (colLUpUser !== -1 && lrow[colLUpUser]) ? lrow[colLUpUser].toString().trim() : "";
          var bUpDate = (colLUpDate !== -1 && lrow[colLUpDate]) ? lrow[colLUpDate].toString().trim() : "";

          locList.push({
            id: k,
            row_index: k + 1,
            branch: bName,
            country: bCountry,
            emr: bEmr,
            location: bLoc,
            updated_by_user: bUpUser,
            updated_by_date: bUpDate
          });
        }
      }
    }

    // 6. Roles
    var rolesSheet = ss.getSheetByName("Roles") || ss.getSheetByName("roles");
    var rolesList = [];
    if (rolesSheet) {
      var rolesData = rolesSheet.getDataRange().getValues();
      for (var ro = 1; ro < rolesData.length; ro++) {
        var rRow = rolesData[ro];
        var rName = rRow[0] ? rRow[0].toString().trim() : "";
        if (!rName) continue;
        rolesList.push({
          id: ro,
          row_index: ro + 1,
          role: rName,
          entry_form: rRow[1] ? rRow[1].toString().trim() : "",
          reports: rRow[2] ? rRow[2].toString().trim() : "",
          download_excel: rRow[3] ? rRow[3].toString().trim() : "",
          updated_by_user: (rRow.length > 4 && rRow[4]) ? rRow[4].toString().trim() : "",
          updated_by_date: (rRow.length > 5 && rRow[5]) ? rRow[5].toString().trim() : ""
        });
      }
    }

    // 7. Attendance_data
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
          row_index: a + 1,
          timestamp: aRow[0] ? aRow[0].toString() : "",
          date: dateFormatted,
          employee_code: aRow[2] ? aRow[2].toString().trim() : "",
          name: aRow[3] ? aRow[3].toString().trim() : "",
          location: aRow[4] ? aRow[4].toString().trim() : "",
          status: aRow[5] ? aRow[5].toString().trim() : "Present",
          check_in: aRow[6] ? aRow[6].toString().trim() : "",
          check_out: aRow[7] ? aRow[7].toString().trim() : "",
          total_hours: aRow[8] ? parseFloat(aRow[8]) : 0.0,
          notes: aRow[9] ? aRow[9].toString().trim() : "",
          updated_by_user: (aRow.length > 10 && aRow[10]) ? aRow[10].toString().trim() : "",
          updated_by_date: (aRow.length > 11 && aRow[11]) ? aRow[11].toString().trim() : ""
        });
      }
    }

    return createJsonResponse({
      status: "success",
      sheet_name: ss.getName(),
      staff_count: staffList.length,
      staff: staffList,
      users_count: usersList.length,
      users: usersList,
      allocations_count: allocList.length,
      allocations: allocList,
      schedules_count: schedList.length,
      schedules: schedList,
      locations_count: locList.length,
      locations: locList,
      roles_count: rolesList.length,
      roles: rolesList,
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

    if (action === "admin_crud" || action === "crud") {
      return handleAdminCrud(ss, payload, tz);
    }

    return createJsonResponse({ status: "unsupported_action" });

  } catch (err) {
    return createJsonResponse({
      status: "error",
      message: err.toString()
    });
  }
}

/**
 * Log Attendance with Audit Trail (Preserves all existing records)
 */
function handleLogAttendance(ss, payload, tz) {
  var targetSheet = ss.getSheetByName("Attendance_data");
  if (!targetSheet) {
    targetSheet = ss.insertSheet("Attendance_data");
    targetSheet.appendRow([
      "Timestamp", "Date", "Employee Code", "Employee Name", "Branch",
      "Status", "Start Time", "End Time", "Total Hours", "Notes",
      "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"
    ]);
    targetSheet.getRange("A1:L1").setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF");
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
  var updatedBy = payload.updated_by_user ? payload.updated_by_user.toString().trim() : (payload.user_name || "User");
  var auditDate = getFormattedAuditDate(tz);

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
      existingRowIndex = r + 1;
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

    targetSheet.getRange(existingRowIndex, 1, 1, 12).setValues([[
      nowTimestamp,
      dateStr,
      empCode,
      empName,
      newBranch,
      newStatus,
      newCheckIn,
      newCheckOut,
      newHours,
      newNotes,
      updatedBy,
      auditDate
    ]]);

    return createJsonResponse({
      status: "success",
      action: "updated",
      message: "Updated attendance for " + empName + " on " + dateStr
    });
  } else {
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
      newNotes,
      updatedBy,
      auditDate
    ]);

    pruneOldAttendanceRecords(targetSheet, tz);

    return createJsonResponse({
      status: "success",
      action: "added",
      message: "Added attendance for " + empName + " on " + dateStr
    });
  }
}

/**
 * Universal Admin CRUD Operations across All Sheets
 * payload: {
 *   sheet_name: 'Staff_data' | 'Users_Data' | 'User_Allocation' | 'Schedule' | 'Locations' | 'Roles',
 *   operation: 'add' | 'edit' | 'delete',
 *   row_index: number (1-based sheet row index, required for edit/delete),
 *   data: object,
 *   updated_by_user: string
 * }
 */
function handleAdminCrud(ss, payload, tz) {
  var sheetName = payload.sheet_name;
  var operation = payload.operation;
  var updatedBy = payload.updated_by_user || "Admin";
  var auditDate = getFormattedAuditDate(tz);

  if (!sheetName || !operation) {
    return createJsonResponse({ status: "error", message: "Missing sheet_name or operation" });
  }

  var sheet = ss.getSheetByName(sheetName);
  
  // Auto-create missing sheets with proper headers if not existing
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    var headers = [];
    if (sheetName === "Staff_data") {
      headers = ["Sl. No.", "Employee Code", "Employee Name", "Designation", "Allocated to", "Whatsapp", "IMAGE", "Gmail", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"];
    } else if (sheetName === "Users_Data") {
      headers = ["UserName", "Gmail", "Country", "Role", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"];
    } else if (sheetName === "User_Allocation") {
      headers = ["Employee Code", "Employee Name", "Allocated to Employee Code", "Allocated to Employee Name", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"];
    } else if (sheetName === "Schedule") {
      headers = ["Branch", "Location", "Visit Date", "Visit Time", "Allocated to Staff", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"];
    } else if (sheetName === "Locations" || sheetName === "Location") {
      headers = ["Branch", "Country", "Emr", "Location", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"];
    } else if (sheetName === "Roles") {
      headers = ["Role", "Attendance Entry Form", "View Reports & Breakdowns", "Download Excel Reports", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"];
    }
    if (headers.length > 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF");
    }
  }

  var data = payload.data || {};

  // 1. DELETE
  if (operation === "delete") {
    var rowIndex = parseInt(payload.row_index, 10);
    if (!rowIndex || rowIndex < 2 || rowIndex > sheet.getLastRow()) {
      return createJsonResponse({ status: "error", message: "Invalid row_index for delete: " + payload.row_index });
    }
    sheet.deleteRow(rowIndex);
    return createJsonResponse({
      status: "success",
      action: "deleted",
      sheet_name: sheetName,
      row_index: rowIndex,
      message: "Deleted record at row " + rowIndex + " in " + sheetName
    });
  }

  // 2. ADD or EDIT row mapping
  var rowValues = [];

  if (sheetName === "Staff_data") {
    var nextSl = sheet.getLastRow();
    rowValues = [
      data.sl_no || nextSl,
      data.employee_code || "",
      data.name || "",
      data.designation || "Staff",
      (data.allocated_to || "HEAD OFFICE").toUpperCase(),
      data.whatsapp || "",
      data.image_url || "",
      (data.gmail || "").toLowerCase().trim(),
      updatedBy,
      auditDate
    ];
  } else if (sheetName === "Users_Data") {
    rowValues = [
      data.user_name || "",
      (data.gmail || "").toLowerCase().trim(),
      (data.country || "UAE").toUpperCase().trim(),
      data.role || "Data_Entry",
      updatedBy,
      auditDate
    ];
  } else if (sheetName === "User_Allocation") {
    rowValues = [
      data.employee_code || "",
      data.employee_name || "",
      data.allocated_to_code || "",
      data.allocated_to_name || "",
      updatedBy,
      auditDate
    ];
  } else if (sheetName === "Schedule") {
    rowValues = [
      data.branch || "",
      data.location || "",
      data.visit_date || "",
      data.visit_time || "",
      data.allocated_to_staff || "",
      updatedBy,
      auditDate
    ];
  } else if (sheetName === "Locations" || sheetName === "Location") {
    rowValues = [
      data.branch || "",
      (data.country || "UAE").toUpperCase().trim(),
      (data.emr || "").toUpperCase().trim(),
      data.location || "",
      updatedBy,
      auditDate
    ];
  } else if (sheetName === "Roles") {
    rowValues = [
      data.role || "",
      data.entry_form || "",
      data.reports || "",
      data.download_excel || "",
      updatedBy,
      auditDate
    ];
  } else {
    return createJsonResponse({ status: "error", message: "Unsupported sheet for CRUD: " + sheetName });
  }

  if (operation === "add") {
    sheet.appendRow(rowValues);
    return createJsonResponse({
      status: "success",
      action: "added",
      sheet_name: sheetName,
      row_index: sheet.getLastRow(),
      message: "Added new record to " + sheetName
    });
  }

  if (operation === "edit") {
    var editRowIndex = parseInt(payload.row_index, 10);
    if (!editRowIndex || editRowIndex < 2 || editRowIndex > sheet.getLastRow()) {
      return createJsonResponse({ status: "error", message: "Invalid row_index for edit: " + payload.row_index });
    }
    sheet.getRange(editRowIndex, 1, 1, rowValues.length).setValues([rowValues]);
    return createJsonResponse({
      status: "success",
      action: "updated",
      sheet_name: sheetName,
      row_index: editRowIndex,
      message: "Updated record at row " + editRowIndex + " in " + sheetName
    });
  }

  return createJsonResponse({ status: "error", message: "Unknown operation: " + operation });
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
