# Emet local chat backend - DESKTOP mode (127.0.0.1 only).
# Launched by the paired .cmd. Keep this file ASCII-only: Windows PowerShell 5.1
# mis-decodes UTF-8 Chinese in .ps1 files. The Chinese status lines are printed
# by node (chat-server.cjs), where UTF-8 works with chcp 65001.

# 1) 40-char token, copied to clipboard (paste into the "暗号" field on desktop)
$env:CC_BRIDGE_TOKEN = -join ((1..40) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
Set-Clipboard $env:CC_BRIDGE_TOKEN

# 2) proxy so claude can reach Anthropic
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
$env:NO_PROXY    = "localhost,127.0.0.1,::1,.local"

Set-Location $PSScriptRoot
node chat-server.cjs
