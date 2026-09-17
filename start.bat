@echo off
cd /d "%~dp0"
echo Starting saveDat Archives at http://localhost:8000
start "" python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
start "" "http://localhost:8000"
pause
