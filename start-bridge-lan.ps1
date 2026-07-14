# Emet local chat backend - PHONE mode (same WiFi / hotspot).
# Launched by the paired .cmd. Keep this file ASCII-only: Windows PowerShell 5.1
# mis-decodes UTF-8 Chinese in .ps1 files. The Chinese hints (token / phone URL)
# are printed by node (chat-server.cjs) below, where UTF-8 works with chcp 65001.

# 1) STABLE token shared with desktop mode: read .cc-bridge-token if present,
#    else generate once and save. Same token across restarts and across both
#    modes -> paste into the "暗号" field once, sync to cloud, never 401 again.
#    (.cc-bridge-token is gitignored - the secret never enters the repo.)
$tokFile = Join-Path $PSScriptRoot ".cc-bridge-token"
if (Test-Path $tokFile) {
  $env:CC_BRIDGE_TOKEN = (Get-Content $tokFile -Raw).Trim()
} else {
  $env:CC_BRIDGE_TOKEN = -join ((1..40) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
  Set-Content -Path $tokFile -Value $env:CC_BRIDGE_TOKEN -NoNewline -Encoding ascii
}
Set-Clipboard $env:CC_BRIDGE_TOKEN

# 2) proxy so claude can reach Anthropic (and node fetch can reach the worker)
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
$env:NO_PROXY    = "localhost,127.0.0.1,::1,.local"
$env:NODE_USE_ENV_PROXY = "1"

# 3) listen on all interfaces so the phone on the same network can connect
$env:CC_BRIDGE_HOST = "0.0.0.0"

# 4) admin key for phone relay (your Emet access key). One-time paste, saved to
#    .cc-admin-key (gitignored). Enables phone chat on the online Emet.
$keyFile = Join-Path $PSScriptRoot ".cc-admin-key"
if (-not (Test-Path $keyFile)) {
  $k = Read-Host "Paste your Emet access key for phone relay (Enter to skip)"
  if ($k.Trim().Length -gt 0) {
    Set-Content -Path $keyFile -Value $k.Trim() -NoNewline -Encoding ascii
  }
}

Set-Location $PSScriptRoot
node chat-server.cjs
