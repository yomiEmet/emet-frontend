# Re-login / switch the Claude account used by local chat (claude -p).
# When to use: subscription login expired (401), switched to a new account,
# or account issues. After login succeeds, local chat works again untouched.
# Proxy must match the machine's Clash port (same as start-bridge.ps1).
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:HTTP_PROXY = 'http://127.0.0.1:7897'

Write-Host '============================================='
Write-Host '  Claude 换号 / 重新登录'
Write-Host ''
Write-Host '  0. 先退出火绒！（托盘右键→退出，登完再开）'
Write-Host '     不退的话登录界面会崩出吓人的报错框'
Write-Host '  1. 马上会打开 claude 的对话界面'
Write-Host '  2. 如果没有自动弹出登录，输入 /login 然后回车'
Write-Host '  3. 按提示在浏览器里登录（新）账号'
Write-Host '  4. 显示登录成功后：关掉本窗口'
Write-Host '  5. 双击「启动本机聊天.cmd」，聊天恢复'
Write-Host ''
Write-Host '  换号后其他任何东西都不用改：'
Write-Host '  暗号、隧道、域名、记忆全部原样能用。'
Write-Host '============================================='
Write-Host ''

$exe = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
if (-not (Test-Path $exe)) { $exe = 'claude' }
& $exe
