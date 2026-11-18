import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from backend.database import init_db
from backend.seed_data import seed_database
from backend.routes import (
    departments,
    staff,
    locations,
    attendance,
    reports,
    settings,
    sheets_sync
)

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
STATIC_DIR = FRONTEND_DIR / "static"

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Initializing Staff Attendance Database & Seeding Data...")
    init_db()
    seed_database()
    print("Attendance System is Ready!")
    yield
    print("Shutting down Attendance System.")

app = FastAPI(
    title="Staff Attendance Management Portal",
    description="Attendance Tracking with 48-Hour Weekly Overtime/Undertime Rules, 20th–19th Cutoff & Branch Locations",
    version="2.1.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Routes
app.include_router(departments.router)
app.include_router(staff.router)
app.include_router(locations.router)
app.include_router(attendance.router)
app.include_router(reports.router)
app.include_router(settings.router)
app.include_router(sheets_sync.router)

# Mount Frontend Static Assets
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "Staff Attendance Management Portal", "version": "2.1.0"}

@app.get("/")
def serve_index():
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return {"message": "Attendance API running. Frontend index.html not found."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.py:app", host="127.0.0.1", port=8000, reload=True)
