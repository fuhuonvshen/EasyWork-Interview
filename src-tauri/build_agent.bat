@echo off
REM EasyWork - 构建 Python Agent 可执行目录
REM 使用 PyInstaller 将 py_backend/ 打包为 onedir（exe + _internal/ 同目录）
REM 运行前请先: pip install pyinstaller

setlocal enabledelayedexpansion

cd /d "%~dp0"

set AGENT_NAME=easywork-agent
set OUT_DIR=binaries

REM 检测目标架构
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set ARCH=x86_64
) else (
    set ARCH=%PROCESSOR_ARCHITECTURE%
)

echo ==^> 正在打包 Python Agent (EasyWork)...
echo    架构: %ARCH%
echo    输出: %OUT_DIR%/%AGENT_NAME%/

REM 清理旧构建
if exist "%AGENT_NAME%.spec" del "%AGENT_NAME%.spec"
REM 用 python 清理旧产物目录（参数传递，空变量只会报错，不会像 rmdir 那样误删盘）
if exist "%OUT_DIR%\%AGENT_NAME%" (
    python -c "import shutil,sys; shutil.rmtree(sys.argv[1])" "%OUT_DIR%\%AGENT_NAME%"
)

REM 创建输出目录
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"

REM 确保 PyInstaller 已安装
pip install pyinstaller >nul 2>&1

REM 执行 PyInstaller
REM agent_launcher.py 位于 py_backend 包外部，避免相对导入问题
REM onedir 模式: 产物为 binaries/easywork-agent/（exe + _internal/）
pyinstaller --onedir ^
    --name "%AGENT_NAME%" ^
    --distpath "%OUT_DIR%" ^
    --add-data "py_backend;py_backend" ^
    --hidden-import uvicorn ^
    --hidden-import uvicorn.logging ^
    --hidden-import uvicorn.loops ^
    --hidden-import uvicorn.loops.auto ^
    --hidden-import uvicorn.protocols ^
    --hidden-import uvicorn.protocols.http ^
    --hidden-import uvicorn.protocols.http.auto ^
    --hidden-import uvicorn.middleware ^
    --hidden-import uvicorn.middleware.debug ^
    --hidden-import httpx ^
    --hidden-import aiosqlite ^
    --collect-all tiktoken --collect-all tiktoken_ext ^
    --hidden-import openpyxl ^
    --hidden-import pandas ^
    --hidden-import pydantic ^
    --collect-all lxml ^
    --hidden-import email.mime.text ^
    --hidden-import email.mime.multipart ^
    --hidden-import email.mime.base ^
    --hidden-import py_backend.tools.sandbox ^
    --hidden-import py_backend.tools.file_preview ^
    --hidden-import py_backend.tools.handlers.email ^
    --hidden-import py_backend.tools.handlers.execute_python ^
    --hidden-import py_backend.tools.handlers.todo ^
    --hidden-import py_backend.tools.handlers.xlsx ^
    -p . ^
    "agent_launcher.py"

if %ERRORLEVEL% NEQ 0 (
    echo [错误] PyInstaller 构建失败
    exit /b 1
)

echo ==^> 构建成功！
echo     输出目录: %OUT_DIR%\%AGENT_NAME%\
echo     主程序: %OUT_DIR%\%AGENT_NAME%\%AGENT_NAME%.exe
echo.
echo 接下来运行 pnpm tauri build 即可将 agent 打包进安装包
