import datetime
from backend.database import get_db, init_db

# ZERO HARDCODED PRIVATE DATA:
# All staff and location records are loaded dynamically from Google Sheets.
LOCATIONS_DATA = []
STAFF_DATA = []

def format_whatsapp(raw_number: str) -> str:
    """Standardizes phone number for WhatsApp wa.me links."""
    if not raw_number:
        return ""
    cleaned = "".join(ch for ch in str(raw_number) if ch.isdigit())
    if not cleaned:
        return ""
    if len(cleaned) == 9 and cleaned.startswith("5"):
        return "971" + cleaned
    if len(cleaned) == 10 and cleaned.startswith("05"):
        return "971" + cleaned[1:]
    return cleaned

def seed_database():
    """
    Initializes database schema and ensures baseline department exists.
    Staff and location data are loaded dynamically from Google Sheets.
    """
    init_db()
    now_str = datetime.datetime.now().isoformat()

    with get_db() as conn:
        cursor = conn.cursor()

        # Ensure base "Inventory" department exists
        cursor.execute("SELECT id FROM departments WHERE name = 'Inventory'")
        dept_row = cursor.fetchone()
        if not dept_row:
            cursor.execute("""
                INSERT INTO departments (name, description, created_at)
                VALUES ('Inventory', 'Inventory management, controllers and warehouse helpers', ?)
            """, (now_str,))

if __name__ == "__main__":
    seed_database()
    print("Database initialized with empty private tables.")
