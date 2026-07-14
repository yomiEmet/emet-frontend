@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM 手机版：让同一 WiFi/热点下的手机也能连（会打印手机要打开的网址）。真正逻辑在 start-bridge-lan.ps1
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0start-bridge-lan.ps1"
