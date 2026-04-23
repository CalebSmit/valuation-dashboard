@echo off
setlocal EnableExtensions

cd /d "%~dp0"

echo.
echo ============================================================
echo   AI Stock Valuation Dashboard - Verification
echo ============================================================
echo.

call :resolve_python
if errorlevel 1 exit /b 1

echo [1/4] Checking backend dependencies...
if not exist "backend\requirements.txt" (
    echo backend\requirements.txt not found.
    exit /b 1
)

echo [2/4] Backend syntax check...
pushd backend
%PYCMD% -m compileall .
if errorlevel 1 (
    popd
    exit /b 1
)
popd

echo [3/4] Frontend tests...
pushd frontend
npm run test
if errorlevel 1 (
    popd
    exit /b 1
)

echo [4/4] Frontend production build...
npm run build
if errorlevel 1 (
    popd
    exit /b 1
)
popd

echo.
echo Dashboard verification passed.
exit /b 0

:resolve_python
py --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PYCMD=py"
    exit /b 0
)

python --version >nul 2>&1
if %errorlevel% equ 0 (
    set "PYCMD=python"
    exit /b 0
)

echo Python not found. Install Python and rerun verification.
exit /b 1
