@echo off
title VideoTemplate Pro - Build
cd /d "%~dp0"

echo ========================================
echo    VideoTemplate Pro - Build Windows
echo ========================================
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo [1/4] Instalando dependencias...
    call npm install
    echo.
) else (
    echo [1/4] Dependencias OK
)

REM Check if ffmpeg-bin exists
if not exist "ffmpeg-bin\ffmpeg.exe" (
    echo [2/4] Baixando FFmpeg...
    echo.
    
    REM Create temp directory
    if not exist "temp" mkdir temp
    
    REM Download FFmpeg using PowerShell
    powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' -OutFile 'temp\ffmpeg.zip'}"
    
    REM Extract using PowerShell
    powershell -Command "& {Expand-Archive -Path 'temp\ffmpeg.zip' -DestinationPath 'temp\ffmpeg' -Force}"
    
    REM Create ffmpeg-bin directory
    if not exist "ffmpeg-bin" mkdir ffmpeg-bin
    
    REM Find and copy ffmpeg.exe and ffprobe.exe
    for /r "temp\ffmpeg" %%f in (ffmpeg.exe) do copy "%%f" "ffmpeg-bin\ffmpeg.exe"
    for /r "temp\ffmpeg" %%f in (ffprobe.exe) do copy "%%f" "ffmpeg-bin\ffprobe.exe"
    
    REM Cleanup
    rmdir /s /q temp
    
    echo FFmpeg baixado e configurado!
    echo.
) else (
    echo [2/4] FFmpeg OK
)

echo [3/4] Compilando aplicacao...
call npm run build
if errorlevel 1 (
    echo.
    echo ERRO: Falha na compilacao!
    pause
    exit /b 1
)

echo.
echo [4/4] Gerando instalador Windows...
call npx electron-builder --win
if errorlevel 1 (
    echo.
    echo ERRO: Falha ao gerar instalador!
    pause
    exit /b 1
)

echo.
echo ========================================
echo    BUILD CONCLUIDO COM SUCESSO!
echo ========================================
echo.
echo O instalador esta em: desktop-app\release\
echo.
echo Arquivos gerados:
dir /b release\*.exe 2>nul
echo.
pause
