import datetime
from fastapi import APIRouter, HTTPException
from backend.database import get_db
from backend.models import LocationCreate, LocationUpdate

router = APIRouter(prefix="/api/locations", tags=["Locations"])

@router.get("")
def list_locations():
    """Returns list of branches and locations matching Google Sheet 'Locations' schema."""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM locations ORDER BY branch ASC").fetchall()
        return {"locations": rows}

@router.get("/branches")
def list_branch_names():
    """Quick endpoint returning distinct branch names for smart typeahead dropdowns."""
    with get_db() as conn:
        rows = conn.execute("SELECT branch, emr, location FROM locations ORDER BY branch ASC").fetchall()
        return {"branches": [r["branch"] for r in rows], "details": rows}

@router.post("")
def create_location(loc: LocationCreate):
    now_str = datetime.datetime.now().isoformat()
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM locations WHERE branch = ?", (loc.branch.strip().upper(),)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Branch already exists")

        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO locations (branch, emr, location, created_at)
            VALUES (?, ?, ?, ?)
        """, (loc.branch.strip().upper(), loc.emr.strip(), loc.location.strip(), now_str))
        new_id = cursor.lastrowid
        return {"id": new_id, "branch": loc.branch.strip().upper(), "message": "Location created successfully"}

@router.put("/{loc_id}")
def update_location(loc_id: int, loc: LocationUpdate):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM locations WHERE id = ?", (loc_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Location not found")

        updates = []
        params = []
        if loc.branch is not None:
            updates.append("branch = ?")
            params.append(loc.branch.strip().upper())
        if loc.emr is not None:
            updates.append("emr = ?")
            params.append(loc.emr.strip())
        if loc.location is not None:
            updates.append("location = ?")
            params.append(loc.location.strip())

        if updates:
            params.append(loc_id)
            conn.execute(f"UPDATE locations SET {', '.join(updates)} WHERE id = ?", params)

        return {"message": "Location updated successfully"}

@router.delete("/{loc_id}")
def delete_location(loc_id: int):
    with get_db() as conn:
        conn.execute("DELETE FROM locations WHERE id = ?", (loc_id,))
        return {"message": "Location deleted successfully"}
