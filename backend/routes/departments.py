import datetime
from fastapi import APIRouter, HTTPException
from backend.database import get_db
from backend.models import DepartmentCreate, DepartmentUpdate

router = APIRouter(prefix="/api/departments", tags=["Departments"])

@router.get("")
def list_departments():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT d.id, d.name, d.description, d.created_at,
                   COUNT(s.id) as staff_count
            FROM departments d
            LEFT JOIN staff s ON s.department_id = d.id AND s.is_active = 1
            GROUP BY d.id
            ORDER BY d.name ASC
        """).fetchall()
        return {"departments": rows}

@router.post("")
def create_department(dept: DepartmentCreate):
    now_str = datetime.datetime.now().isoformat()
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM departments WHERE name = ?", (dept.name.strip(),)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Department with this name already exists")

        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO departments (name, description, created_at)
            VALUES (?, ?, ?)
        """, (dept.name.strip(), dept.description, now_str))
        dept_id = cursor.lastrowid
        return {"id": dept_id, "name": dept.name.strip(), "description": dept.description, "message": "Department created"}

@router.put("/{dept_id}")
def update_department(dept_id: int, dept: DepartmentUpdate):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM departments WHERE id = ?", (dept_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Department not found")

        updates = []
        params = []
        if dept.name is not None:
            updates.append("name = ?")
            params.append(dept.name.strip())
        if dept.description is not None:
            updates.append("description = ?")
            params.append(dept.description)

        if updates:
            params.append(dept_id)
            conn.execute(f"UPDATE departments SET {', '.join(updates)} WHERE id = ?", params)

        return {"message": "Department updated successfully"}

@router.delete("/{dept_id}")
def delete_department(dept_id: int):
    with get_db() as conn:
        staff_count = conn.execute("SELECT COUNT(*) as cnt FROM staff WHERE department_id = ? AND is_active = 1", (dept_id,)).fetchone()["cnt"]
        if staff_count > 0:
            raise HTTPException(status_code=400, detail=f"Cannot delete department: {staff_count} active staff members are assigned to it.")

        conn.execute("DELETE FROM departments WHERE id = ?", (dept_id,))
        return {"message": "Department deleted successfully"}
