# Emet local chat backend - PHONE mode (same WiFi / hotspot).
# Launched by the paired .cmd. Keep this file ASCII-only: Windows PowerShell 5.1
# mis-decodes UTF-8 Chinese in .ps1 files. The Chinese hints (token / phone URL)
# are printed by node (chat-server.cjs) below, where UTF-8 works with chcp 65001.

# 1) short 8-char token (you'll type it on the phone; node prints its value below)
$env:CC_BRIDGE_TOKEN = -join ((1..8) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })

# 2) proxy so claude can reach Anthropic
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
$env:NO_PROXY    = "localhost,127.0.0.1,::1,.local"

# 3) listen on all interfaces so the phone on the same network can connect
$env:CC_BRIDGE_HOST = "0.0.0.0"

Set-Location $PSScriptRoot
node chat-server.cjs
