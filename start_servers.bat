@echo off

cd /d "%~dp0"

REM Start Flask
start "Flask Server" cmd /k "uv run python -m flask --app main run"

REM Give Flask time to start
timeout /t 2 /nobreak >nul

REM Start ngrok
start "ngrok" cmd /k "ngrok http 5000"