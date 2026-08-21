@echo off
setlocal
cd /d "%~dp0backend"
if not errorlevel 1 goto :found
echo [错误] 找不到 backend 目录，请确认 start.bat 位于项目根目录
pause
exit /b 1

:found
netstat -ano | findstr ":8000 " | findstr "LISTENING" >nul
if not errorlevel 1 goto :portbusy
goto :portfree

:portbusy
echo.
echo [提示] 端口 8000 已被占用，可能有旧的 MindForge 实例残留。
set "OLDPID="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING"') do set "OLDPID=%%p"
if not defined OLDPID goto :portbusy_manual
echo        正在自动关闭旧实例 ^(PID: %OLDPID%^) ...
taskkill /F /PID %OLDPID% >nul 2>nul
if errorlevel 1 goto :portbusy_manual
echo        端口已释放，继续启动...
goto :portfree

:portbusy_manual
echo        自动释放失败，请手动结束占用 8000 端口的进程：
echo        1. 打开任务管理器 -^> 详细信息 -^> 找到 python.exe 进程 -^> 结束任务
echo           或按 PID（上一条命令输出）结束对应进程
echo        2. 若提示权限不足，请右键以管理员身份运行 cmd，再执行：
echo           taskkill /F /PID 占用PID
echo        3. 完成后重新运行 start.bat
echo.
pause
exit /b 0

:portfree
set "PY="
if exist "C:\Users\laity\.workbuddy\binaries\python\envs\default\Scripts\python.exe" set "PY=C:\Users\laity\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
if defined PY goto :ready
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
if defined PY goto :ready

echo [首次运行] 创建虚拟环境并安装依赖，约 1-2 分钟...
where python >nul 2>nul
if errorlevel 1 goto :usepy
set "PYTHON=python"
goto :makevenv
:usepy
set "PYTHON=py -3"

:makevenv
%PYTHON% -m venv .venv
if errorlevel 1 goto :venvfail
set "PY=.venv\Scripts\python.exe"
"%PY%" -m pip install -r requirements.txt
if errorlevel 1 goto :pipfail
goto :ready

:venvfail
echo [错误] 未找到 Python，请先安装 Python 3.10+ 并加入 PATH
pause
exit /b 1

:pipfail
echo [错误] 依赖安装失败，请检查网络
pause
exit /b 1

:ready
echo.
echo   MindForge 心智锻造 启动中 -^> http://127.0.0.1:8000
echo   未配置 LLM_API_KEY 时自动使用本地 Mock 演示模式。
echo   保持此窗口开启即服务运行中；按 Ctrl+C 可停止服务。
echo.
"%PY%" -m uvicorn main:app --host 127.0.0.1 --port 8000
echo.
echo [已退出] 服务已停止，按任意键关闭窗口。
pause
