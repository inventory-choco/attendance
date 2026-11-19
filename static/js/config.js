/**
 * Staff Attendance Portal Configuration
 * 
 * 1. GOOGLE APPS SCRIPT WEB APP URL:
 *    Deploy 'google_apps_script.js' in your Google Sheet (Extensions > Apps Script > Deploy as Web App).
 *    Set 'Execute as': Me, 'Who has access': Anyone.
 *    Paste the generated Web App URL into GOOGLE_SCRIPT_URL below.
 * 
 * 2. GOOGLE CLIENT ID (For Google Gmail Login):
 *    Paste your Google OAuth 2.0 Web Client ID into GOOGLE_CLIENT_ID below.
 */
window.APP_CONFIG = {
    // Paste your Google Apps Script Web App URL here:
    GOOGLE_SCRIPT_URL: "https://script.google.com/macros/s/AKfycby68mBl0QGZKK4O_UKuGdDxwdt6XtrbpqNKJ6Ji9ZpKpsZzvGGxIcAagR1T_c1kzdSnZA/exec",

    // Google Sign-In Client ID (Google Cloud Console OAuth 2.0 Web Client ID)
    GOOGLE_CLIENT_ID: "188969693421-8ebob1ei8ks5j4dnq2j92la9mo1kqgfi.apps.googleusercontent.com",

    // Business Rules
    AUTO_REFRESH_MINUTES: 60,      // Automatically reload live data from Google Sheet every 1 hour
    CUTOFF_START_DAY: 20,          // 20th of month
    CUTOFF_END_DAY: 19,            // 19th of next month
    WEEKLY_TARGET_HOURS: 48.0,     // 48.0 hours required per week
    
    // Default Week Off (WO): Thursday (4) and Saturday (6)
    // In JavaScript getDay(): 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
    AUTO_WO_DAYS: [4, 6],

    // Spreadsheet Reference Link
    SPREADSHEET_LINK: "https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y/edit?usp=sharing"
};
