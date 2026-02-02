@echo off
title Video Processor Desktop
cd /d "%~dp0"

echo ========================================
echo    Video Processor Desktop App
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
    echo.
)

echo Iniciando o aplicativo...
echo.
call npm run dev

pause
