import datetime
from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from backend.database import get_db
from backend.models import StaffCreate, StaffUpdate
from backend.seed_data import format_whatsapp

router = APIRouter(prefix="/api/staff", tags=["Staff"])

@router.get("")
def list_staff(
    department_id: Optional[int] = None,
    location: Optional[str] = None,
    search: Optional[str] = None,
    active_only: bool = True
):
    query = """
        SELECT s.*, d.name as department_name
        FROM staff s
        JOIN departments d ON d.id = s.department_id
        WHERE 1=1
    """
    params = []

    if active_only:
        query += " AND s.is_active = 1"
    if department_id:
        query += " AND s.department_id = ?"
        params.append(department_id)
    if location and location.upper() != "ALL":
        query += " AND UPPER(s.allocated_to) = UPPER(?)"
        params.append(location)
    if search:
        query += " AND (s.name LIKE ? OR s.employee_code LIKE ? OR s.designation LIKE ?)"
        wildcard = f"%{search.strip()}%"
        params.extend([wildcard, wildcard, wildcard])

    query += " ORDER BY s.sl_no ASC, s.name ASC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
        return {"staff": rows, "count": len(rows)}

@router.get("/search")
def smart_search_staff(q: str = Query(..., min_length=1)):
    """
    Smart search box endpoint: searches staff by partial name, employee code, or designation.
    Returns matched staff for fast autocomplete.
    """
    wildcard = f"%{q.strip()}%"
    with get_db() as conn:
        rows = conn.execute("""
            SELECT s.id, s.sl_no, s.employee_code, s.name, s.designation, s.allocated_to, s.whatsapp, s.image_url
            FROM staff s
            WHERE s.is_active = 1
              AND (s.name LIKE ? OR s.employee_code LIKE ? OR s.designation LIKE ?)
            ORDER BY
              CASE WHEN s.employee_code LIKE ? THEN 1
                   WHEN s.name LIKE ? THEN 2
                   ELSE 3 END,
              s.sl_no ASC
            LIMIT 15
        """, (wildcard, wildcard, wildcard, f"{q.strip()}%", f"{q.strip()}%")).fetchall()
        return {"results": rows}

@router.get("/{staff_id}")
def get_staff_detail(staff_id: int):
    with get_db() as conn:
        row = conn.execute("""
            SELECT s.*, d.name as department_name
            FROM staff s
            JOIN departments d ON d.id = s.department_id
            WHERE s.id = ?
        """, (staff_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Staff member not found")
        return row

@router.post("")
def create_staff(staff: StaffCreate):
    now_str = datetime.datetime.now().isoformat()
    formatted_wa = format_whatsapp(staff.whatsapp)

    avatar = staff.image_url
    if not avatar:
        avatar = f"https://api.dicebear.com/7.x/initials/svg?seed={staff.name}&backgroundColor=0284c7,0d9488,4f46e5,7c3aed&textColor=ffffff"

    with get_db() as conn:
        cursor = conn.cursor()

        # Check unique employee_code
        existing_code = cursor.execute("SELECT id FROM staff WHERE employee_code = ?", (staff.employee_code.strip(),)).fetchone()
        if existing_code:
            raise HTTPException(status_code=400, detail=f"Employee Code '{staff.employee_code}' already exists")

        sl_no = staff.sl_no
        if not sl_no:
            max_sl = cursor.execute("SELECT MAX(sl_no) as max_sl FROM staff").fetchone()["max_sl"] or 0
            sl_no = max_sl + 1

        cursor.execute("""
            INSERT INTO staff (
                sl_no, employee_code, name, designation, department_id,
                allocated_to, whatsapp, image_url, is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """, (
            sl_no, staff.employee_code.strip(), staff.name.strip(), staff.designation.strip(), staff.department_id,
            staff.allocated_to.strip().upper(), formatted_wa, avatar, now_str, now_str
        ))
        new_id = cursor.lastrowid
        return {"id": new_id, "message": "Staff member created successfully"}

@router.put("/{staff_id}")
def update_staff(staff_id: int, staff: StaffUpdate):
    now_str = datetime.datetime.now().isoformat()
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM staff WHERE id = ?", (staff_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Staff member not found")

        updates = ["updated_at = ?"]
        params = [now_str]

        if staff.sl_no is not None:
            updates.append("sl_no = ?")
            params.append(staff.sl_no)
        if staff.employee_code is not None:
            updates.append("employee_code = ?")
            params.append(staff.employee_code.strip())
        if staff.name is not None:
            updates.append("name = ?")
            params.append(staff.name.strip())
        if staff.designation is not None:
            updates.append("designation = ?")
            params.append(staff.designation.strip())
        if staff.department_id is not None:
            updates.append("department_id = ?")
            params.append(staff.department_id)
        if staff.allocated_to is not None:
            updates.append("allocated_to = ?")
            params.append(staff.allocated_to.strip().upper())
        if staff.whatsapp is not None:
            updates.append("whatsapp = ?")
            params.append(format_whatsapp(staff.whatsapp))
        if staff.image_url is not None:
            updates.append("image_url = ?")
            params.append(staff.image_url)
        if staff.is_active is not None:
            updates.append("is_active = ?")
            params.append(staff.is_active)

        params.append(staff_id)
        conn.execute(f"UPDATE staff SET {', '.join(updates)} WHERE id = ?", params)
        return {"message": "Staff member updated successfully"}

@router.delete("/{staff_id}")
def delete_staff(staff_id: int):
    with get_db() as conn:
        conn.execute("UPDATE staff SET is_active = 0 WHERE id = ?", (staff_id,))
        return {"message": "Staff member deactivated successfully"}
