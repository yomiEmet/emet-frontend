@echo off
chcp 65001 >nul
REM 双击我即可启动本机聊天后端。真正的启动逻辑在同目录的 启动本机聊天.ps1
REM （设代理 7897 + 生成暗号复制剪贴板 + 跑 chat-server.cjs），窗口保持打开。
powershell -NoExit -ExecutionPolicy Bypass -File "%~dp0启动本机聊天.ps1"
