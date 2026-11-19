/**
 * Staff Attendance Portal Configuration
 * 
 * To connect your Google Sheet permanently for ALL users on GitHub Pages:
 * 1. Deploy the Apps Script from 'google_apps_script.js' in your Google Sheet.
 * 2. Paste the generated Web App URL below between the quotes in GOOGLE_SCRIPT_URL.
 * 3. Commit and push to GitHub!
 */
window.APP_CONFIG = {
    // Paste your Google Apps Script Web App URL here:
    GOOGLE_SCRIPT_URL: "",

    // System Business Rules
    AUTO_REFRESH_MINUTES: 60,      // Automatically reload live data from Google Sheet every 1 hour
    CUTOFF_START_DAY: 20,          // 20th of month
    CUTOFF_END_DAY: 19,            // 19th of next month
    WEEKLY_TARGET_HOURS: 48.0,     // 48.0 hours required per week
    AUTO_WO_DAYS: [0, 5],          // Sunday (0) and Friday (5) are automatically "WO" if no shift logged
    
    // Spreadsheet reference link (for user guidance)
    SPREADSHEET_LINK: "https://docs.google.com/spreadsheets/d/1fKcoTVzIqvA4fsq75oOxXLp2tqQ-e74UZNVhPWFp3-Y/edit?usp=sharing"
};
