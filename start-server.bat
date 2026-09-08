@echo off
title GovRisk Web App
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required but was not found.
    echo Install it from https://nodejs.org and run this file again.
    pause
    exit /b 1
)

set GOVRISK_NO_BROWSER=1
echo Starting GovRisk local server...
start "GovRisk Server" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul

echo.
echo If your browser did not open automatically, visit:
echo   http://localhost:8765/
echo.
echo Default admin: admin / admin123
echo Create a viewer account from the login page.
echo.
echo To stop the server, close the "GovRisk Server" window.
pause