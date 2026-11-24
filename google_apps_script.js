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

function formatTimeSafe(val) {
  if (!val) return "";
  if (val instanceof Date) {
    var hh = ("0" + val.getHours()).slice(-2);
    var mm = ("0" + val.getMinutes()).slice(-2);
    return hh + ":" + mm;
  }
  var str = val.toString().trim();
  if (str.indexOf("1899") !== -1 || str.indexOf("GMT") !== -1) {
    try {
      var d = new Date(str);
      if (!isNaN(d.getTime())) {
        var dhh = ("0" + d.getHours()).slice(-2);
        var dmm = ("0" + d.getMinutes()).slice(-2);
        return dhh + ":" + dmm;
      }
    } catch(e) {}
  }
  var m = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    return ("0" + m[1]).slice(-2) + ":" + m[2];
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

var _currentCallback = "";

function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = Session.getScriptTimeZone();
  var params = (e && e.parameter) ? e.parameter : {};
  _currentCallback = (params.callback || params.jsonp || "").toString().trim();
  var action = params.action || "get_all";

  // Support attendance logging via GET to bypass 302 POST body loss
  if (action === "log_attendance") {
    try {
      var payloadStr = params.payload || params.data;
      if (!payloadStr) {
        return createJsonResponse({ status: "error", message: "Missing payload parameter" });
      }
      var payload = null;
      try {
        payload = (typeof payloadStr === "string") ? JSON.parse(decodeURIComponent(payloadStr)) : payloadStr;
      } catch (decErr) {
        payload = (typeof payloadStr === "string") ? JSON.parse(payloadStr) : payloadStr;
      }
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
      var crudPayload = null;
      try {
        crudPayload = (typeof crudPayloadStr === "string") ? JSON.parse(decodeURIComponent(crudPayloadStr)) : crudPayloadStr;
      } catch (decErr) {
        crudPayload = (typeof crudPayloadStr === "string") ? JSON.parse(crudPayloadStr) : crudPayloadStr;
      }
      return handleAdminCrud(ss, crudPayload, tz);
    } catch (err) {
      return createJsonResponse({ status: "error", message: "GET CRUD error: " + err.toString() });
    }
  }

  // Support Fetch Sheet Name via GET
  if (action === "fetch_sheet_name" || action === "get_sheet_name") {
    try {
      var targetUrl = params.url || params.link || "";
      var resolvedTitle = fetchGoogleSheetName(targetUrl);
      return createJsonResponse({ status: "success", sheet_name: resolvedTitle });
    } catch (err) {
      return createJsonResponse({ status: "error", message: "Fetch sheet name error: " + err.toString() });
    }
  }

  try {
    // 1. Staff_data
    // Columns: Sl. No. | Employee Code | Employee Name | Designation | Allocated to | Whatsapp | IMAGE | Gmail | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
    var staffSheet = ss.getSheetByName("Staff_data") || ss.getSheets()[0];
    var staffData = staffSheet ? staffSheet.getDataRange().getValues() : [];
    var staffFormulas = staffSheet ? staffSheet.getDataRange().getFormulas() : [];
    var staffList = [];

    var sHeaders = (staffData.length > 0) ? staffData[0].map(function(h) { return h ? h.toString().toLowerCase().trim() : ""; }) : [];
    var colSl = sHeaders.indexOf("sl. no.");
    if (colSl === -1) colSl = sHeaders.indexOf("sl");
    if (colSl === -1) colSl = 0;
    
    var colCode = sHeaders.indexOf("employee code");
    if (colCode === -1) colCode = sHeaders.indexOf("code");
    if (colCode === -1) colCode = 1;

    var colName = sHeaders.indexOf("employee name");
    if (colName === -1) colName = sHeaders.indexOf("name");
    if (colName === -1) colName = 2;

    var colDesig = sHeaders.indexOf("designation");
    if (colDesig === -1) colDesig = 3;

    var colAlloc = sHeaders.indexOf("allocated to");
    if (colAlloc === -1) colAlloc = sHeaders.indexOf("branch");
    if (colAlloc === -1) colAlloc = 4;

    var colWhatsapp = sHeaders.indexOf("whatsapp");
    if (colWhatsapp === -1) colWhatsapp = 5;

    var colImage = sHeaders.indexOf("image");
    if (colImage === -1) colImage = sHeaders.indexOf("photo");
    if (colImage === -1) colImage = 6;

    var colGmail = sHeaders.indexOf("gmail");
    if (colGmail === -1) colGmail = sHeaders.indexOf("email");
    if (colGmail === -1) colGmail = 7;

    var colUpUser = -1;
    var colUpDate = -1;
    for (var shi = 0; shi < sHeaders.length; shi++) {
      if (sHeaders[shi].indexOf("updated by user") !== -1) colUpUser = shi;
      if (sHeaders[shi].indexOf("updated by date") !== -1) colUpDate = shi;
    }
    if (colUpUser === -1) colUpUser = 8;
    if (colUpDate === -1) colUpDate = 9;

    for (var i = 1; i < staffData.length; i++) {
      var row = staffData[i];
      var empName = (colName !== -1 && row[colName]) ? row[colName].toString().trim() : "";
      if (!empName) continue;
      
      var slNo = (colSl !== -1 && row[colSl]) ? parseInt(row[colSl], 10) : i;
      var empCode = (colCode !== -1 && row[colCode]) ? row[colCode].toString().trim() : ("EMP-" + i);
      var designation = (colDesig !== -1 && row[colDesig]) ? row[colDesig].toString().trim() : "Staff";
      var allocatedTo = (colAlloc !== -1 && row[colAlloc]) ? row[colAlloc].toString().trim().toUpperCase() : "HEAD OFFICE";
      var whatsapp = (colWhatsapp !== -1 && row[colWhatsapp]) ? row[colWhatsapp].toString().trim() : "";
      var rawImg = (colImage !== -1 && row[colImage]) ? row[colImage] : null;
      var imageUrl = "";
      if (rawImg) {
        if (typeof rawImg === "object" && typeof rawImg.getContentUrl === "function") {
          try { imageUrl = rawImg.getContentUrl(); } catch(e){}
        } else if (typeof rawImg === "object" && typeof rawImg.getUrl === "function") {
          try { imageUrl = rawImg.getUrl(); } catch(e){}
        } else {
          imageUrl = rawImg.toString().trim();
        }
      }
      if (imageUrl === "[object Object]" || imageUrl === "CellImage") {
        imageUrl = "";
      }

      var gmail = (colGmail !== -1 && row[colGmail]) ? row[colGmail].toString().trim().toLowerCase() : "";
      var updatedBy = (colUpUser !== -1 && row.length > colUpUser && row[colUpUser]) ? row[colUpUser].toString().trim() : "";
      var updatedDate = (colUpDate !== -1 && row.length > colUpDate && row[colUpDate]) ? row[colUpDate].toString().trim() : "";

      // Check for formula if cell returned "CellImage", "[object Object]" or empty
      if (!imageUrl && staffFormulas.length > i && colImage !== -1 && staffFormulas[i][colImage]) {
        var fStr = staffFormulas[i][colImage].toString();
        var fMatch = fStr.match(/IMAGE\s*\(\s*["']?([^"',)]+)["']?/i);
        if (fMatch) imageUrl = fMatch[1].trim();
      }

      // Convert Google Drive view/open links to direct embeddable links
      if (imageUrl && imageUrl.indexOf("drive.google.com") !== -1) {
        var driveIdMatch = imageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || imageUrl.match(/id=([a-zA-Z0-9_-]+)/);
        if (driveIdMatch && driveIdMatch[1]) {
          imageUrl = "https://lh3.googleusercontent.com/d/" + driveIdMatch[1];
        }
      }

      var hasCustomImage = (imageUrl && imageUrl !== "CellImage" && imageUrl !== "[object Object]" && imageUrl.length > 5);
      if (!hasCustomImage) {
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
        has_custom_image: hasCustomImage,
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
    // Supported Columns: Branch | Location | Visit Start Date | Visit Start Time | Visit End Date | Visit End Time | Allocated to Staff | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
    // Also backwards-compatible with 7 columns: Branch | Location | Visit Date | Visit Time | Allocated to Staff | Updated By User | Updated By date
    var schedSheet = ss.getSheetByName("Schedule") || ss.getSheetByName("schedule");
    var schedList = [];
    if (schedSheet) {
      var schedData = schedSheet.getDataRange().getValues();
      if (schedData.length > 1) {
        var sHeaders = schedData[0].map(function(h) { return h ? h.toString().toLowerCase().trim() : ""; });
        var colSBranch = 0;
        var colSLoc = 1;
        var colSStartDate = -1;
        var colSStartTime = -1;
        var colSEndDate = -1;
        var colSEndTime = -1;
        var colSStaff = -1;
        var colSUpUser = -1;
        var colSUpDate = -1;

        for (var shi = 0; shi < sHeaders.length; shi++) {
          var sh = sHeaders[shi];
          if (sh.indexOf("start date") !== -1 || sh.indexOf("date start") !== -1) colSStartDate = shi;
          else if (sh.indexOf("visit date") !== -1 || sh === "date") { if (colSStartDate === -1) colSStartDate = shi; }
          
          if (sh.indexOf("start time") !== -1 || sh.indexOf("time start") !== -1) colSStartTime = shi;
          else if (sh.indexOf("visit time") !== -1 || sh === "time") { if (colSStartTime === -1) colSStartTime = shi; }

          if (sh.indexOf("end date") !== -1 || sh.indexOf("date end") !== -1) colSEndDate = shi;
          if (sh.indexOf("end time") !== -1 || sh.indexOf("time end") !== -1) colSEndTime = shi;

          if (sh.indexOf("staff") !== -1 || sh.indexOf("allocated") !== -1) colSStaff = shi;
          if (sh.indexOf("updated by user") !== -1) colSUpUser = shi;
          if (sh.indexOf("updated by date") !== -1) colSUpDate = shi;
        }

        // Positional defaults if headers didn't match
        if (colSStartDate === -1) colSStartDate = 2;
        if (colSStartTime === -1) colSStartTime = 3;
        if (colSEndDate === -1 && schedData[0].length >= 8) {
          colSEndDate = 4;
          colSEndTime = 5;
          if (colSStaff === -1) colSStaff = 6;
          if (colSUpUser === -1) colSUpUser = 7;
          if (colSUpDate === -1) colSUpDate = 8;
        } else {
          if (colSStaff === -1) colSStaff = 4;
          if (colSUpUser === -1) colSUpUser = 5;
          if (colSUpDate === -1) colSUpDate = 6;
        }

        for (var sc = 1; sc < schedData.length; sc++) {
          var sRow = schedData[sc];
          var sBranch = sRow[colSBranch] ? sRow[colSBranch].toString().trim() : "";
          var sLoc = (colSLoc !== -1 && sRow[colSLoc]) ? sRow[colSLoc].toString().trim() : "";
          var sStartDate = (colSStartDate !== -1 && sRow[colSStartDate]) ? formatDateSafe(sRow[colSStartDate], tz) : "";
          var sStartTime = (colSStartTime !== -1 && sRow[colSStartTime]) ? formatTimeSafe(sRow[colSStartTime]) : "09:00";
          var sEndDate = (colSEndDate !== -1 && sRow[colSEndDate]) ? formatDateSafe(sRow[colSEndDate], tz) : sStartDate;
          var sEndTime = (colSEndTime !== -1 && sRow[colSEndTime]) ? formatTimeSafe(sRow[colSEndTime]) : "18:00";
          var sStaff = (colSStaff !== -1 && sRow[colSStaff]) ? sRow[colSStaff].toString().trim() : "";
          var sUpdatedBy = (colSUpUser !== -1 && sRow[colSUpUser]) ? sRow[colSUpUser].toString().trim() : "";
          var sUpdatedDate = (colSUpDate !== -1 && sRow[colSUpDate]) ? sRow[colSUpDate].toString().trim() : "";

          if (!sBranch && !sStartDate && !sStaff) continue;

          schedList.push({
            id: sc,
            row_index: sc + 1,
            branch: sBranch,
            location: sLoc,
            visit_start_date: sStartDate,
            visit_start_time: sStartTime,
            visit_end_date: sEndDate || sStartDate,
            visit_end_time: sEndTime || "18:00",
            visit_date: sStartDate,
            visit_time: sStartTime,
            allocated_to_staff: sStaff,
            updated_by_user: sUpdatedBy,
            updated_by_date: sUpdatedDate
          });
        }
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
    // Headers: Role | Selected Staff Daily Breakdown | Organization Summary Table | Staff Directory | Branch Visit Schedule | Branch Reports | Admin Portal | Staff Directory (Admin) | User Access & Roles | Staff Allocation | Branches & Locations | Roles & Permissions | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
    var rolesSheet = ss.getSheetByName("Roles") || ss.getSheetByName("roles");
    var rolesList = [];
    if (rolesSheet) {
      var rolesData = rolesSheet.getDataRange().getValues();
      if (rolesData.length > 1) {
        var rHeaders = rolesData[0].map(function(h) { return h ? h.toString().toLowerCase().trim() : ""; });

        var colMap = {
          daily_breakdown: findHeaderCol(rHeaders, ["daily breakdown", "selected staff daily breakdown", "attendance entry form", "entry"]),
          summary_table: findHeaderCol(rHeaders, ["summary table", "organization summary", "summary", "reports & breakdowns", "reports"]),
          staff_directory: findHeaderCol(rHeaders, ["staff directory", "roster", "directory"]),
          branch_schedule: findHeaderCol(rHeaders, ["branch visit schedule", "schedule", "visit schedule"]),
          branch_reports: findHeaderCol(rHeaders, ["branch reports", "reports sheet", "branch report"]),
          admin_portal: findHeaderCol(rHeaders, ["admin portal", "portal"]),
          admin_staff: findHeaderCol(rHeaders, ["staff directory (admin)", "admin staff", "staff master"]),
          admin_users: findHeaderCol(rHeaders, ["user access & roles", "users & roles", "user access", "users"]),
          admin_allocations: findHeaderCol(rHeaders, ["staff allocation", "user allocation", "allocations"]),
          admin_locations: findHeaderCol(rHeaders, ["branches & locations", "locations", "branches"]),
          admin_roles: findHeaderCol(rHeaders, ["roles & permissions", "roles"]),
          updated_by_user: findHeaderCol(rHeaders, ["updated by user", "updated by"]),
          updated_by_date: findHeaderCol(rHeaders, ["updated by date"])
        };

        var moduleKeys = [
          'daily_breakdown', 'summary_table', 'staff_directory', 'branch_schedule', 'branch_reports',
          'admin_portal', 'admin_staff', 'admin_users', 'admin_allocations', 'admin_locations', 'admin_roles'
        ];

        for (var ro = 1; ro < rolesData.length; ro++) {
          var rRow = rolesData[ro];
          var rName = rRow[0] ? rRow[0].toString().trim() : "";
          if (!rName) continue;

          var perms = {};

          for (var m = 0; m < moduleKeys.length; m++) {
            var mKey = moduleKeys[m];
            var colIdx = colMap[mKey];
            var valStr = (colIdx !== -1 && rRow.length > colIdx && rRow[colIdx]) ? rRow[colIdx].toString().trim() : "";
            
            // If empty and sheet was using old columns, apply smart defaults
            if (!valStr) {
              if (rName.toLowerCase() === "admin") {
                valStr = "View, Edit, Delete, Download";
              } else if (rName.toLowerCase() === "data_entry") {
                if (mKey === "daily_breakdown" || mKey === "branch_schedule" || mKey === "branch_reports") {
                  valStr = "View, Edit";
                } else if (mKey === "summary_table" || mKey === "staff_directory") {
                  valStr = "View";
                } else {
                  valStr = "None";
                }
              } else if (rName.toLowerCase() === "report_only") {
                if (mKey.indexOf("admin") === -1) {
                  valStr = "View, Download";
                } else {
                  valStr = "None";
                }
              } else {
                valStr = "None";
              }
            }

            perms[mKey] = parseActionsString(valStr);
          }

          var upUser = (colMap.updated_by_user !== -1 && rRow.length > colMap.updated_by_user && rRow[colMap.updated_by_user]) ? rRow[colMap.updated_by_user].toString().trim() : "";
          var upDate = (colMap.updated_by_date !== -1 && rRow.length > colMap.updated_by_date && rRow[colMap.updated_by_date]) ? rRow[colMap.updated_by_date].toString().trim() : "";

          rolesList.push({
            id: ro,
            row_index: ro + 1,
            role: rName,
            permissions: perms,
            entry_form: rRow[1] ? rRow[1].toString().trim() : (perms.daily_breakdown ? perms.daily_breakdown.raw : ""),
            reports: rRow[2] ? rRow[2].toString().trim() : (perms.summary_table ? perms.summary_table.raw : ""),
            download_excel: rRow[3] ? rRow[3].toString().trim() : (perms.daily_breakdown && perms.daily_breakdown.download ? "Download Allowed" : "Blocked"),
            updated_by_user: upUser || (rRow.length > 4 && rRow[4] ? rRow[4].toString().trim() : "Admin"),
            updated_by_date: upDate || (rRow.length > 5 && rRow[5] ? rRow[5].toString().trim() : "")
          });
        }
      }
    }

    // 7. Branch_Reports
    // Columns: Date | Branch Name | Google sheet Link | Google Sheet Name | Updated By User | Updated By date [dd:mm:yy hh:mm:ss]
    var repSheet = ss.getSheetByName("Branch_Reports") || ss.getSheetByName("branch_reports") || ss.getSheetByName("Branch Reports");
    var branchReportsList = [];
    if (repSheet) {
      var repData = repSheet.getDataRange().getValues();
      if (repData.length > 1) {
        var rHeaders = repData[0].map(function(h) { return h ? h.toString().toLowerCase().trim() : ""; });
        var colRDate = -1;
        var colRBranch = -1;
        var colRLink = -1;
        var colRName = -1;
        var colRUpUser = -1;
        var colRUpDate = -1;

        for (var ri = 0; ri < rHeaders.length; ri++) {
          var rh = rHeaders[ri];
          if (rh.indexOf("date") !== -1 && rh.indexOf("updated") === -1) colRDate = ri;
          else if (rh.indexOf("branch") !== -1) colRBranch = ri;
          else if (rh.indexOf("link") !== -1 || rh.indexOf("url") !== -1) colRLink = ri;
          else if (rh.indexOf("sheet name") !== -1 || (rh.indexOf("name") !== -1 && rh.indexOf("branch") === -1)) colRName = ri;
          else if (rh.indexOf("updated by user") !== -1 || rh.indexOf("updated by") !== -1) colRUpUser = ri;
          else if (rh.indexOf("updated by date") !== -1) colRUpDate = ri;
        }

        if (colRDate === -1) colRDate = 0;
        if (colRBranch === -1) colRBranch = 1;
        if (colRLink === -1) colRLink = 2;
        if (colRName === -1) colRName = 3;
        if (colRUpUser === -1) colRUpUser = 4;
        if (colRUpDate === -1) colRUpDate = 5;

        for (var r = 1; r < repData.length; r++) {
          var rRow = repData[r];
          var rDate = (colRDate !== -1 && rRow[colRDate]) ? formatDateSafe(rRow[colRDate], tz) : "";
          var rBranch = (colRBranch !== -1 && rRow[colRBranch]) ? rRow[colRBranch].toString().trim() : "";
          var rLink = (colRLink !== -1 && rRow[colRLink]) ? rRow[colRLink].toString().trim() : "";
          var rName = (colRName !== -1 && rRow[colRName]) ? rRow[colRName].toString().trim() : "";
          var rUpUser = (colRUpUser !== -1 && rRow[colRUpUser]) ? rRow[colRUpUser].toString().trim() : "";
          var rUpDate = (colRUpDate !== -1 && rRow[colRUpDate]) ? rRow[colRUpDate].toString().trim() : "";

          if (!rDate && !rBranch && !rLink) continue;

          branchReportsList.push({
            id: r,
            row_index: r + 1,
            report_date: rDate,
            branch_name: rBranch,
            sheet_link: rLink,
            sheet_name: rName || "Google Sheet",
            updated_by_user: rUpUser,
            updated_by_date: rUpDate
          });
        }
      }
    }

    // 8. Attendance_data
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
          check_in: formatTimeSafe(aRow[6]),
          check_out: formatTimeSafe(aRow[7]),
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
      branch_reports_count: branchReportsList.length,
      branch_reports: branchReportsList,
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
  _currentCallback = "";
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

    if (action === "fetch_sheet_name" || action === "get_sheet_name") {
      var targetUrl = payload.url || payload.link || "";
      var resolvedTitle = fetchGoogleSheetName(targetUrl);
      return createJsonResponse({ status: "success", sheet_name: resolvedTitle });
    }

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
 * Process staff photo: Saves base64 images to Google Drive CDN, formats Drive URLs
 */
function processStaffImage(imageUrl, empCode, empName) {
  if (!imageUrl || typeof imageUrl !== "string") return imageUrl || "";
  imageUrl = imageUrl.trim();

  // If already a web URL
  if (imageUrl.indexOf("http://") === 0 || imageUrl.indexOf("https://") === 0) {
    if (imageUrl.indexOf("drive.google.com") !== -1) {
      var dMatch = imageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || imageUrl.match(/id=([a-zA-Z0-9_-]+)/);
      if (dMatch && dMatch[1]) {
        return "https://lh3.googleusercontent.com/d/" + dMatch[1];
      }
    }
    return imageUrl;
  }

  // If base64 data URL, upload to Google Drive for fast global CDN access
  if (imageUrl.indexOf("data:image") === 0) {
    try {
      var parts = imageUrl.split(",");
      var meta = parts[0];
      var base64Content = parts[1];
      var mimeType = meta.split(";")[0].split(":")[1] || "image/jpeg";
      var ext = (mimeType.indexOf("png") !== -1) ? ".png" : ".jpg";
      var decodedBytes = Utilities.base64Decode(base64Content);
      var safeName = (empName || "Staff").toString().replace(/[^a-zA-Z0-9]/g, "_");
      var filename = "Staff_" + (empCode || "0000") + "_" + safeName + ext;
      var blob = Utilities.newBlob(decodedBytes, mimeType, filename);

      var folderName = "Staff_Attendance_Photos";
      var folders = DriveApp.getFoldersByName(folderName);
      var targetFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
      targetFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      var driveFile = targetFolder.createFile(blob);
      driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      var fileId = driveFile.getId();
      return "https://lh3.googleusercontent.com/d/" + fileId;
    } catch (e) {
      return imageUrl;
    }
  }

  return imageUrl;
}

/**
 * Log Attendance with Audit Trail (Preserves all existing records)
 */
function handleLogAttendance(ss, payload, tz) {
  var lock = LockService.getScriptLock();
  var gotLock = false;
  try { gotLock = lock.tryLock(25000); } catch(e){}

  try {
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
  } finally {
    if (gotLock) {
      try { lock.releaseLock(); } catch(e){}
    }
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
  var lock = LockService.getScriptLock();
  var gotLock = false;
  try { gotLock = lock.tryLock(25000); } catch(e){}

  try {
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
      headers = ["Branch", "Location", "Visit Start Date", "Visit Start Time", "Visit End Date", "Visit End Time", "Allocated to Staff", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"];
    } else if (sheetName === "Locations" || sheetName === "Location") {
      headers = ["Branch", "Country", "Emr", "Location", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"];
    } else if (sheetName === "Roles") {
      headers = [
        "Role", "Selected Staff Daily Breakdown", "Organization Summary Table", "Staff Directory",
        "Branch Visit Schedule", "Branch Reports", "Admin Portal", "Staff Directory (Admin)",
        "User Access & Roles", "Staff Allocation", "Branches & Locations", "Roles & Permissions",
        "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"
      ];
    } else if (sheetName === "Branch_Reports" || sheetName === "branch_reports" || sheetName === "Branch Reports") {
      headers = ["Date", "Branch Name", "Google sheet Link", "Google Sheet Name", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"];
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
    var editRowIndex = parseInt(payload.row_index, 10);
    var sExisting = (operation === "edit" && editRowIndex && editRowIndex <= sheet.getLastRow()) ? sheet.getRange(editRowIndex, 1, 1, Math.max(sheet.getLastColumn(), 10)).getValues()[0] : [];

    var sSl = (data.sl_no !== undefined && data.sl_no !== "") ? data.sl_no : (sExisting[0] || sheet.getLastRow());
    var sCode = (data.employee_code !== undefined && data.employee_code !== "") ? data.employee_code : (sExisting[1] || "");
    var sName = (data.name !== undefined && data.name !== "") ? data.name : (sExisting[2] || "");
    var sDesig = (data.designation !== undefined && data.designation !== "") ? data.designation : (sExisting[3] || "Staff");
    var sAlloc = (data.allocated_to !== undefined && data.allocated_to !== "") ? data.allocated_to.toString().toUpperCase() : (sExisting[4] || "HEAD OFFICE");
    var sWhatsapp = (data.whatsapp !== undefined) ? data.whatsapp : (sExisting[5] || "");
    var sImage = (data.image_url !== undefined && data.image_url !== "") ? data.image_url : (sExisting[6] || "");
    sImage = processStaffImage(sImage, sCode, sName);
    var sGmail = (data.gmail !== undefined) ? data.gmail.toString().toLowerCase().trim() : (sExisting[7] || "");

    rowValues = [
      sSl,
      sCode,
      sName,
      sDesig,
      sAlloc,
      sWhatsapp,
      sImage,
      sGmail,
      updatedBy,
      auditDate
    ];
  } else if (sheetName === "Users_Data") {
    // Exact schema: Col A: UserName | Col B: Gmail | Col C: Country | Col D: Role | Col E: Updated By User | Col F: Updated By date [dd:mm:yy hh:mm:ss]
    var editRowIndex = parseInt(payload.row_index, 10);
    var uExisting = (operation === "edit" && editRowIndex && editRowIndex <= sheet.getLastRow()) ? sheet.getRange(editRowIndex, 1, 1, Math.max(sheet.getLastColumn(), 6)).getValues()[0] : [];

    var uName = (data.user_name !== undefined && data.user_name !== "") ? data.user_name : (uExisting[0] || "");
    var uGmail = (data.gmail !== undefined && data.gmail !== "") ? data.gmail.toString().toLowerCase().trim() : (uExisting[1] || "").toString().toLowerCase().trim();
    
    // Preserve Country (Col C) untouched if not explicitly changed
    var uCountry = (data.country !== undefined && data.country !== "") ? data.country.toString().toUpperCase().trim() : (uExisting[2] || "UAE").toString().toUpperCase().trim();
    if (uCountry === "OM") uCountry = "OMAN";

    // Target Column D for Role edits
    var uRole = (data.role !== undefined && data.role !== "") ? data.role : (uExisting[3] || "Data_Entry");

    // Ensure header row is aligned
    if (sheet.getLastRow() >= 1) {
      var headerRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 6)).getValues()[0].map(function(h) { return h ? h.toString().toLowerCase().trim() : ""; });
      var cIdx = headerRow.indexOf("country");
      var rIdx = headerRow.indexOf("role");
      if (cIdx === -1 || rIdx === -1 || cIdx > rIdx) {
        sheet.getRange(1, 1, 1, 6).setValues([[
          "UserName", "Gmail", "Country", "Role", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"
        ]]);
        sheet.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF");
      }
    }

    rowValues = [
      uName,
      uGmail,
      uCountry,
      uRole,
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
    // Check if the sheet header is 9 columns or upgrade it if needed
    var firstRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    var firstRowStr = firstRow.join(" ").toLowerCase();
    var hasEndCols = (firstRowStr.indexOf("end date") !== -1 || firstRowStr.indexOf("start date") !== -1 || firstRow.length >= 9);

    if (!hasEndCols && sheet.getLastColumn() <= 7) {
      sheet.getRange(1, 1, 1, 9).setValues([[
        "Branch", "Location", "Visit Start Date", "Visit Start Time", "Visit End Date", "Visit End Time",
        "Allocated to Staff", "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"
      ]]);
      sheet.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF");
    }

    rowValues = [
      data.branch || "",
      data.location || "",
      data.visit_start_date || data.visit_date || "",
      data.visit_start_time || data.visit_time || "09:00",
      data.visit_end_date || data.visit_start_date || data.visit_date || "",
      data.visit_end_time || "18:00",
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
    // Check if the sheet header is upgraded to 14 columns
    var firstRow = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0];
    var firstRowStr = firstRow.join(" ").toLowerCase();
    var hasGranularCols = (firstRowStr.indexOf("daily breakdown") !== -1 || firstRow.length >= 12);

    if (!hasGranularCols && sheet.getLastColumn() <= 7) {
      var fullHeaders = [
        "Role", "Selected Staff Daily Breakdown", "Organization Summary Table", "Staff Directory",
        "Branch Visit Schedule", "Branch Reports", "Admin Portal", "Staff Directory (Admin)",
        "User Access & Roles", "Staff Allocation", "Branches & Locations", "Roles & Permissions",
        "Updated By User", "Updated By date [dd:mm:yy hh:mm:ss]"
      ];
      sheet.getRange(1, 1, 1, 14).setValues([fullHeaders]);
      sheet.getRange(1, 1, 1, 14).setFontWeight("bold").setBackground("#0F172A").setFontColor("#FFFFFF");
    }

    var perms = data.permissions || {};
    function getPVal(k, fallback) {
      var val = perms[k] !== undefined ? perms[k] : (data[k] !== undefined ? data[k] : fallback);
      return formatPermString(val);
    }

    rowValues = [
      data.role || "",
      getPVal("daily_breakdown", data.entry_form),
      getPVal("summary_table", data.reports),
      getPVal("staff_directory"),
      getPVal("branch_schedule"),
      getPVal("branch_reports"),
      getPVal("admin_portal"),
      getPVal("admin_staff"),
      getPVal("admin_users"),
      getPVal("admin_allocations"),
      getPVal("admin_locations"),
      getPVal("admin_roles"),
      updatedBy,
      auditDate
    ];
  } else if (sheetName === "Branch_Reports" || sheetName === "branch_reports" || sheetName === "Branch Reports") {
    var bLink = (data.sheet_link || data.link || "").toString().trim();
    var bName = (data.sheet_name || "").toString().trim();
    if (!bName && bLink) {
      bName = fetchGoogleSheetName(bLink);
    }
    if (!bName && bLink) {
      bName = "Branch Report (" + (data.branch_name || "Sheet") + ")";
    }

    rowValues = [
      data.report_date || data.date || formatDateSafe(new Date(), tz),
      data.branch_name || data.branch || "",
      bLink,
      bName,
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
  } finally {
    if (gotLock) {
      try { lock.releaseLock(); } catch(e){}
    }
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
  var jsonString = JSON.stringify(data);
  if (_currentCallback && /^[a-zA-Z0-9_$.]+$/.test(_currentCallback)) {
    return ContentService.createTextOutput(_currentCallback + "(" + jsonString + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(jsonString)
    .setMimeType(ContentService.MimeType.JSON);
}

function dailyMaintenance() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var targetSheet = ss.getSheetByName("Attendance_data");
  if (targetSheet) {
    pruneOldAttendanceRecords(targetSheet, Session.getScriptTimeZone());
  }
}

/**
 * Helper to extract Google Sheet / Document Title from URL
 */
function fetchGoogleSheetName(url) {
  if (!url || typeof url !== "string") return "";
  url = url.trim();
  var idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || url.match(/id=([a-zA-Z0-9-_]+)/) || url.match(/^([a-zA-Z0-9-_]{25,})$/);
  if (!idMatch || !idMatch[1]) return "";
  var sheetId = idMatch[1];
  var title = "";

  // 1. Try SpreadsheetApp
  try {
    var ss = SpreadsheetApp.openById(sheetId);
    if (ss) title = ss.getName();
  } catch(e) {}

  // 2. Try DriveApp
  if (!title) {
    try {
      var file = DriveApp.getFileById(sheetId);
      if (file) title = file.getName();
    } catch(e) {}
  }

  // 3. Try UrlFetchApp to extract <title> tag
  if (!title) {
    try {
      var resp = UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/" + sheetId + "/edit", {
        muteHttpExceptions: true,
        followRedirects: true
      });
      if (resp && resp.getResponseCode() === 200) {
        var html = resp.getContentText();
        var tMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (tMatch && tMatch[1]) {
          title = tMatch[1].replace(/\s*[-–—|]\s*(Google Sheets|Google Drive|جداول بيانات Google|Google Docs).*$/i, "").trim();
        }
      }
    } catch(e) {}
  }

  return title ? title.trim() : "";
}

/**
 * Finds a column index matching any candidate string (case-insensitive substring)
 */
function findHeaderCol(headers, candidates) {
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i];
    for (var c = 0; c < candidates.length; c++) {
      if (h === candidates[c] || h.indexOf(candidates[c]) !== -1) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Parses a permission string (e.g. "View, Edit, Delete, Download" or "All") into boolean flags
 */
function parseActionsString(str) {
  if (!str) return { view: false, edit: false, delete: false, download: false, raw: "None" };
  var s = str.toString().toLowerCase().trim();
  if (s === "all" || s === "full access" || s === "full") {
    return { view: true, edit: true, delete: true, download: true, raw: "View, Edit, Delete, Download" };
  }
  var v = s.indexOf("view") !== -1;
  var e = s.indexOf("edit") !== -1;
  var d = s.indexOf("delete") !== -1;
  var dl = s.indexOf("download") !== -1;
  var parts = [];
  if (v) parts.push("View");
  if (e) parts.push("Edit");
  if (d) parts.push("Delete");
  if (dl) parts.push("Download");
  return {
    view: v,
    edit: e,
    delete: d,
    download: dl,
    raw: parts.length > 0 ? parts.join(", ") : "None"
  };
}

/**
 * Formats boolean action flags or string into a clean comma-separated list
 */
function formatPermString(val) {
  if (!val) return "None";
  if (typeof val === "string") return val.trim();
  if (typeof val === "object") {
    var parts = [];
    if (val.view) parts.push("View");
    if (val.edit) parts.push("Edit");
    if (val.delete) parts.push("Delete");
    if (val.download) parts.push("Download");
    return parts.length > 0 ? parts.join(", ") : "None";
  }
  return "None";
}
