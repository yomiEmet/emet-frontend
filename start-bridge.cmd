@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM ASCII wrapper for the logon scheduled task (same as 启动本机聊天.cmd).
REM Scheduled tasks + Chinese filenames are a quoting minefield; this avoids it.
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0start-bridge.ps1"
