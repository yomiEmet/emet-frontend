# Emet local chat backend - DESKTOP mode (127.0.0.1 only).
# Launched by the paired .cmd. Keep this file ASCII-only: Windows PowerShell 5.1
# mis-decodes UTF-8 Chinese in .ps1 files. The Chinese status lines are printed
# by node (chat-server.cjs), where UTF-8 works with chcp 65001.

# 1) STABLE token: read from .cc-bridge-token if it exists, else generate once and save.
#    This keeps the token identical across restarts, so you only paste it into the
#    "暗号" field once and never see a 401 from a changed token again.
#    (.cc-bridge-token is gitignored - the secret never enters the repo.)
$tokFile = Join-Path $PSScriptRoot ".cc-bridge-token"
if (Test-Path $tokFile) {
  $env:CC_BRIDGE_TOKEN = (Get-Content $tokFile -Raw).Trim()
} else {
  $env:CC_BRIDGE_TOKEN = -join ((1..40) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  Set-Content -Path $tokFile -Value $env:CC_BRIDGE_TOKEN -NoNewline -Encoding ascii
}
Set-Clipboard $env:CC_BRIDGE_TOKEN

# 2) proxy so claude can reach Anthropic
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
$env:NO_PROXY    = "localhost,127.0.0.1,::1,.local"

Set-Location $PSScriptRoot
node chat-server.cjs
