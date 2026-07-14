# Emet 本机聊天后端 —— 手机版（同一 WiFi/热点下，手机也能连）
# 由「启动本机聊天-连手机.cmd」双击调用。

# 1) 生成一个【短暗号】(8位)——等下要在手机上手输，短一点好打
$env:CC_BRIDGE_TOKEN = -join ((1..8) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })

# 2) 代理（claude 连 Anthropic 要走 7897）
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
$env:NO_PROXY    = "localhost,127.0.0.1,::1,.local"

# 3) 关键：监听所有网卡，让同一 WiFi/热点下的手机能连进来（有暗号保护，别人没暗号连不了）
$env:CC_BRIDGE_HOST = "0.0.0.0"

Write-Host ""
Write-Host "===================================================" -ForegroundColor Green
Write-Host "   手机上要输入的【暗号】： $($env:CC_BRIDGE_TOKEN)" -ForegroundColor Green
Write-Host "   (读自己屏幕没事，别把这一屏截图发给别人就行)" -ForegroundColor DarkGray
Write-Host "===================================================" -ForegroundColor Green
Write-Host "   下面会打印【手机要打开的网址】(带 172.20.10 那个)，一起照着在手机上输" -ForegroundColor Yellow
Write-Host "   若弹出防火墙/火绒「是否允许」——选允许(专用/家庭网络)" -ForegroundColor DarkGray
Write-Host ""

Set-Location $PSScriptRoot
node chat-server.cjs
