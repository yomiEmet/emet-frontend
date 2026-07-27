# Re-login / switch the Claude account used by local chat (claude -p).
# Encoding note: this file MUST be saved as UTF-8 WITH BOM, or Windows
# PowerShell 5.1 reads the Chinese text as mojibake (garbled).
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:HTTP_PROXY = 'http://127.0.0.1:7897'

Write-Host '============================================='
Write-Host '  Claude 换号 / 重新登录'
Write-Host ''
Write-Host '  0. 先退出火绒（托盘右键-退出，登完再开）'
Write-Host '     不退的话登录界面会崩出吓人的报错框'
Write-Host '  1. 按回车后会打开 claude 的对话界面'
Write-Host '  2. 没自动弹登录就输入 /login 然后回车'
Write-Host '  3. 按提示在浏览器里登录（新）账号'
Write-Host '  4. 登录成功后：关掉本窗口'
Write-Host '  5. 双击「启动本机聊天.cmd」，聊天恢复'
Write-Host ''
Write-Host '  换号后其他东西都不用改：暗号、隧道、'
Write-Host '  域名、记忆全部原样能用。'
Write-Host '============================================='
Write-Host ''
Read-Host '看完上面的步骤后，按回车打开 claude'

# Run claude from a neutral folder: login is account-level, and starting
# it inside the project folder would needlessly load project context.
Set-Location $env:USERPROFILE
$exe = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
if (-not (Test-Path $exe)) { $exe = 'claude' }
& $exe
