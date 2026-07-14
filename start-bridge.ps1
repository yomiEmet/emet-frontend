# Emet 本机聊天后端 一键启动（代理 + 暗号 + 复制剪贴板 + 启桥）
# 由同目录的「启动本机聊天.cmd」双击调用。文件名用英文，避免 cmd 处理中文路径出错。

# 1) 生成 40 位随机暗号（每次启动都换一个，更安全），并复制到剪贴板
$env:CC_BRIDGE_TOKEN = -join ((1..40) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
Set-Clipboard $env:CC_BRIDGE_TOKEN

# 2) 设代理：claude 要走 7897 口才能连上 Anthropic（漏了这步会 403）
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
$env:NO_PROXY    = "localhost,127.0.0.1,::1,.local"

Write-Host ""
Write-Host "OK 暗号已生成并复制到剪贴板 —— 等下在前端「本机 Claude」的暗号栏直接 Ctrl+V 粘贴" -ForegroundColor Green
Write-Host "   出现下面这行就成功：  鉴权：✓ 已开  —— 然后这个窗口别关" -ForegroundColor Yellow
Write-Host "   若窗口里蹦出 401 = 登录过期；403 = 代理没通" -ForegroundColor DarkGray
Write-Host ""

# 3) 进项目目录，启动本机桥
Set-Location $PSScriptRoot
node chat-server.cjs
