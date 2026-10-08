@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 灵魂碎片 - Monkey Business

echo ============================================
echo   灵魂碎片 - Monkey Business
echo   正在启动本地服务器...
echo ============================================
echo.

set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/"

REM 释放端口（兼容中英文 netstat 输出）
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  if not "%%a"=="0" taskkill /F /PID %%a >nul 2>&1
)

echo [地址] %URL%
echo [提示] 关闭本窗口即停止游戏
echo.

REM ---------- 优先 Node（含 NodeLoc 登录 / 速通榜）----------
where node >nul 2>&1
if %errorlevel%==0 (
  echo [引擎] Node.js （含 NodeLoc 登录 / 速通榜）
  node scripts/serve.js
  goto :end
)

echo [警告] 未检测到 Node.js，将使用静态服务器（无登录与速通榜）
echo.
start "" /b cmd /c "timeout /t 1 /nobreak >nul & start %URL%"

REM ---------- 尝试 Python ----------
where python >nul 2>&1
if %errorlevel%==0 (
  python -c "import http.server" >nul 2>&1
  if not errorlevel 1 (
    echo [引擎] Python
    python -m http.server %PORT% --bind 127.0.0.1
    goto :end
  )
)

where py >nul 2>&1
if %errorlevel%==0 (
  echo [引擎] py launcher
  py -3 -m http.server %PORT% --bind 127.0.0.1
  goto :end
)

if exist "S:\software\anaconda3\python.exe" (
  echo [引擎] Anaconda Python
  "S:\software\anaconda3\python.exe" -m http.server %PORT% --bind 127.0.0.1
  goto :end
)

REM ---------- PowerShell 兜底（Win10+ 自带）----------
echo [引擎] PowerShell
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0_serve.ps1" -Port %PORT%

:end
echo.
echo 服务器已停止。若浏览器空白，请确认地址为 %URL%
pause
