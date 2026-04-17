@echo off
title Smart Factory - START
echo.
echo ==========================================
echo    SEDANG MENJALANKAN SERVER...
echo ==========================================
echo.
echo Jika jendela ini tertutup, silakan install Node.js 
echo dari https://nodejs.org/ terlebih dahulu.
echo.
echo Dashboard: http://localhost:3000
echo.

:: 2. Cek Port 3000
echo [2/4] Mengecek Port 3000...
:: Mencari PID yang menggunakan port 3000 dan mematikannya
powershell -Command "Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }" >nul 2>&1
echo [OK] Port 3000 siap.

:: Menjalankan server dan memaksa jendela tetap terbuka meskipun error
cmd /k "node server.js"
