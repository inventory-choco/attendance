#!/usr/bin/env bash
echo "======================================================================"
echo "          STAFF ATTENDANCE & PAYROLL CUTOFF SYSTEM"
echo "      48-Hour Weekly Overtime Rules - Cutoff 20th to 19th"
echo "======================================================================"

cd "$(dirname "$0")"

python3 -m pip install -r requirements.txt --quiet
echo "Starting Attendance Server at http://127.0.0.1:8000 ..."
python3 -m uvicorn app:app --host 127.0.0.1 --port 8000 --reload
