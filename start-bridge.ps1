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

# 2) proxy so claude can reach Anthropic (and node fetch can reach the worker)
$env:HTTPS_PROXY = "http://127.0.0.1:7897"
$env:HTTP_PROXY  = "http://127.0.0.1:7897"
$env:NO_PROXY    = "localhost,127.0.0.1,::1,.local"
# make node's built-in fetch honor the proxy env vars (for the relay -> worker calls)
$env:NODE_USE_ENV_PROXY = "1"

# 3) admin key for phone relay (your Emet access key). One-time: paste it once,
#    saved to .cc-admin-key (gitignored). Lets the phone chat on the online Emet
#    with no extra token. Skip by pressing Enter if you only use the computer.
$keyFile = Join-Path $PSScriptRoot ".cc-admin-key"
if (-not (Test-Path $keyFile)) {
  $k = Read-Host "Paste your Emet access key for phone relay (Enter to skip)"
  if ($k.Trim().Length -gt 0) {
    Set-Content -Path $keyFile -Value $k.Trim() -NoNewline -Encoding ascii
  }
}

Set-Location $PSScriptRoot

# 4) Clean up a leftover bridge holding port 8000 (a previous window that didn't
#    fully die on Ctrl+C). Without this, the new `node` crashes on EADDRINUSE,
#    the finally-block below fires and kills the tunnel -> "Bad Gateway" + a
#    stale old-code bridge. Killing the port occupant first makes restarts clean.
$stale = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($stale) {
  $stale | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 600
}

# 5) Cloudflare Tunnel is now a Windows SERVICE (installed once via
#    `cloudflared service install`, reading ~\.cloudflared\config.yml).
#    -> It runs system-wide, auto-starts on boot, auto-restarts on crash, and is
#       fully independent of this window. This script no longer touches the tunnel.
#    Root fix for the old "Ctrl+C on the bridge -> emethome 502" pain: the bridge
#    and the tunnel now have completely separate lifecycles.
#    Manage the tunnel with: stop-tunnel.ps1 / start-tunnel.ps1 (service stop/start).

# Bridge runs in THIS window (foreground). Ctrl+C stops only the bridge; the
# tunnel service keeps running and reconnects to the bridge when you restart it.
node chat-server.cjs
