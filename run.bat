@echo off
title Staff Attendance Management Portal
echo ======================================================================
echo           STAFF ATTENDANCE & PAYROLL CUTOFF SYSTEM
echo       48-Hour Weekly Overtime Rules - Cutoff 20th to 19th
echo ======================================================================
echo.

cd /d "%~dp0"

echo [1/3] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in PATH!
    pause
    exit /b 1
)

echo [2/3] Installing/verifying required packages...
python -m pip install -r requirements.txt --quiet

echo [3/3] Starting Attendance Application Server at http://127.0.0.1:8000 ...
start "" http://127.0.0.1:8000

python -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
pause
