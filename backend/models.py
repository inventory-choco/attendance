from pydantic import BaseModel, Field
from typing import Optional, List

class LocationCreate(BaseModel):
    branch: str = Field(..., min_length=1, description="Branch Name e.g. DUBAI, ABU DHABI, RAK")
    emr: str = Field(..., min_length=1, description="Emirate e.g. Dubai, Abu Dhabi, Sharjah")
    location: str = Field(..., min_length=1, description="Detailed location / Warehouse address")

class LocationUpdate(BaseModel):
    branch: Optional[str] = None
    emr: Optional[str] = None
    location: Optional[str] = None

class DepartmentCreate(BaseModel):
    name: str = Field(..., min_length=1, description="Department name")
    description: Optional[str] = ""

class DepartmentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class StaffCreate(BaseModel):
    sl_no: Optional[int] = None
    employee_code: str = Field(..., min_length=1, description="Employee Code / ID e.g. INV-001 or 3002")
    name: str = Field(..., min_length=2, description="Employee Full Name")
    designation: str = Field(..., min_length=2, description="Designation e.g. Inventory Controller")
    department_id: int
    allocated_to: str = Field(..., min_length=1, description="Branch name from Locations")
    whatsapp: Optional[str] = ""
    image_url: Optional[str] = ""

class StaffUpdate(BaseModel):
    sl_no: Optional[int] = None
    employee_code: Optional[str] = None
    name: Optional[str] = None
    designation: Optional[str] = None
    department_id: Optional[int] = None
    allocated_to: Optional[str] = None
    whatsapp: Optional[str] = None
    image_url: Optional[str] = None
    is_active: Optional[int] = None

class AttendancePunch(BaseModel):
    staff_id: int
    date: str                               # YYYY-MM-DD
    check_in: Optional[str] = None          # HH:MM
    check_out: Optional[str] = None         # HH:MM
    break_minutes: Optional[int] = 0
    total_hours: Optional[float] = None     # Decimal hours
    status: Optional[str] = "Present"       # Present, WO, OFF, Paid Leave, Sick Leave, Unpaid Leave, Holiday
    shift_type: Optional[str] = "Regular"
    location: Optional[str] = None          # Branch name
    notes: Optional[str] = None

class DailyHoursEntry(BaseModel):
    staff_id: int
    date: str                               # YYYY-MM-DD
    total_hours: float
    status: Optional[str] = "Present"

class BulkDailyEntry(BaseModel):
    entries: List[DailyHoursEntry]

class SettingsUpdate(BaseModel):
    cutoff_start_day: Optional[str] = None
    cutoff_end_day: Optional[str] = None
    weekly_target_hours: Optional[str] = None
    prorate_partial_week: Optional[str] = None
    daily_standard_hours: Optional[str] = None
    auto_week_off_days: Optional[str] = None
    google_sheet_id: Optional[str] = None
    google_sheets_webhook_url: Optional[str] = None
    company_name: Optional[str] = None
