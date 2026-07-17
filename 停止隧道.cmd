@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM 关闭隧道 = 让 emethome.com 下线。桥（本机聊天）不受影响。
powershell -ExecutionPolicy Bypass -File "%~dp0stop-tunnel.ps1"
pause
