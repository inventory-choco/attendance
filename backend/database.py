import sqlite3
import json
from contextlib import contextmanager
from datetime import datetime
from backend.config import DB_PATH, DEFAULT_SETTINGS

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = dict_factory
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Initializes tables for Attendance, Staff, Locations, Departments, and Settings."""
    with get_db() as conn:
        cursor = conn.cursor()

        # 1. Locations Table (Headers: Branch, Emr, Location)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                branch TEXT UNIQUE NOT NULL,
                emr TEXT NOT NULL,
                location TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        """)

        # 2. Departments Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS departments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL
            );
        """)

        # 3. Staff Table (Pure Attendance - Sl. No., Employee Code, Employee Name, Designation, Allocated to, Whatsapp, IMAGE)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS staff (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sl_no INTEGER,
                employee_code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                designation TEXT NOT NULL,
                department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
                allocated_to TEXT NOT NULL,
                whatsapp TEXT,
                image_url TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)

        # 4. Attendance Logs Table (Enforces 1 entry per staff per date; tracks Hours, Status, Shift, Location)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS attendance_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
                date TEXT NOT NULL,                 -- YYYY-MM-DD
                check_in TEXT,                      -- HH:MM
                check_out TEXT,                     -- HH:MM
                break_minutes INTEGER DEFAULT 0,
                total_hours REAL NOT NULL DEFAULT 0.0,
                status TEXT DEFAULT 'Present',      -- Present, WO, OFF, Paid Leave, Sick Leave, Unpaid Leave, Holiday
                shift_type TEXT DEFAULT 'Regular',  -- Regular, Morning, Evening, Night, Split
                location TEXT,                      -- Branch name from Locations
                notes TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(staff_id, date)
            );
        """)

        # 5. System Settings Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                description TEXT
            );
        """)

        # 6. Sync Logs Table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                synced_at TEXT NOT NULL,
                direction TEXT NOT NULL,
                status TEXT NOT NULL,
                records_count INTEGER DEFAULT 0,
                details TEXT
            );
        """)

        # Insert default settings if not exists
        for key, val in DEFAULT_SETTINGS.items():
            cursor.execute("""
                INSERT OR IGNORE INTO system_settings (key, value, description)
                VALUES (?, ?, ?)
            """, (key, val, f"Default setting for {key}"))

def get_setting(key: str, default: str = "") -> str:
    with get_db() as conn:
        row = conn.execute("SELECT value FROM system_settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

def set_setting(key: str, value: str):
    with get_db() as conn:
        conn.execute("""
            INSERT INTO system_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """, (key, value))
