from fastapi import APIRouter
from backend.database import get_db, set_setting
from backend.models import SettingsUpdate
from backend.config import DEFAULT_SETTINGS

router = APIRouter(prefix="/api/settings", tags=["Settings"])

@router.get("")
def get_all_settings():
    with get_db() as conn:
        rows = conn.execute("SELECT key, value, description FROM system_settings").fetchall()
        settings_dict = {r["key"]: r["value"] for r in rows}
        return {"settings": settings_dict, "details": rows}

@router.post("")
def update_settings(payload: SettingsUpdate):
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is not None:
            set_setting(k, str(v))
    return {"message": "Settings updated successfully", "updated": list(data.keys())}

@router.post("/reset-defaults")
def reset_to_defaults():
    for k, v in DEFAULT_SETTINGS.items():
        set_setting(k, str(v))
    return {"message": "Settings restored to factory defaults"}
