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

# 4) Cloudflare Tunnel: publish emethome.com -> local bridge (127.0.0.1:8000),
#    gated by Cloudflare Access (email OTP, only your email). Runs in a minimized
#    side window. Kill any leftover cloudflared first so it's single-instance,
#    and stop it again when the bridge exits (closing this window stops both).
$cfExe = Join-Path $PSScriptRoot "cloudflared.exe"
$cfCfg = Join-Path $PSScriptRoot "cloudflared-config.yml"
$cfProc = $null
if ((Test-Path $cfExe) -and (Test-Path $cfCfg)) {
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  $cfProc = Start-Process -FilePath $cfExe `
    -ArgumentList "tunnel","--config",$cfCfg,"run","emet-bridge" `
    -WindowStyle Minimized -PassThru
}

try {
  node chat-server.cjs
} finally {
  if ($cfProc -and -not $cfProc.HasExited) { Stop-Process -Id $cfProc.Id -Force -ErrorAction SilentlyContinue }
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
