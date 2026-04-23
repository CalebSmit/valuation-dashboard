@echo off
setlocal EnableExtensions EnableDelayedExpansion

if not defined DASHBOARD_BACKEND_PORT set "DASHBOARD_BACKEND_PORT=8000"
if not defined DASHBOARD_FRONTEND_PORT set "DASHBOARD_FRONTEND_PORT=5173"
if not defined DASHBOARD_BACKEND_HOST set "DASHBOARD_BACKEND_HOST=127.0.0.1"

echo ============================================================
echo   AI Stock Valuation Dashboard
echo ============================================================
echo.

cd /d "%~dp0"

if not exist "..\raw_data.xlsx" (
    echo [WARNING] raw_data.xlsx not found.
    echo           Run "py main.py" from the project root before starting the dashboard.
    echo.
    pause
    exit /b 1
)

py --version >nul 2>&1
if errorlevel 1 (
    echo Python launcher "py" not found. Install Python and rerun this script.
    pause
    exit /b 1
)

npm --version >nul 2>&1
if errorlevel 1 (
    echo npm not found. Install Node.js 18+ and rerun this script.
    pause
    exit /b 1
)

echo [1/3] Starting backend server on %DASHBOARD_BACKEND_HOST%:%DASHBOARD_BACKEND_PORT%...
pushd backend
start "Valuation Dashboard Backend" cmd /k "set VALUATION_DASHBOARD_BACKEND_PORT=%DASHBOARD_BACKEND_PORT% && set VALUATION_DASHBOARD_BACKEND_HOST=%DASHBOARD_BACKEND_HOST% && py -m uvicorn main:app --port %DASHBOARD_BACKEND_PORT% --host %DASHBOARD_BACKEND_HOST%"
popd

echo [2/3] Waiting for backend health check...
set "BACKEND_READY="
for /L %%A in (1,1,20) do (
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing http://%DASHBOARD_BACKEND_HOST%:%DASHBOARD_BACKEND_PORT%/api/health; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
    if !errorlevel! equ 0 (
        set "BACKEND_READY=1"
        goto :backend_ready
    )
    timeout /t 1 /nobreak >nul
)

:backend_ready
if not defined BACKEND_READY (
    echo Backend did not become healthy within 20 seconds.
    echo Check the backend terminal window for the exact error.
    pause
    exit /b 1
)

echo [3/3] Starting frontend dev server on http://localhost:%DASHBOARD_FRONTEND_PORT% ...
start http://localhost:%DASHBOARD_FRONTEND_PORT%
pushd frontend
npm run dev -- --port %DASHBOARD_FRONTEND_PORT%
popd

echo.
echo Dashboard stopped. Press any key to exit.
pause
