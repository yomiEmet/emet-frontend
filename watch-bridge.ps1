# Bridge watchdog: if nothing listens on port 8000, relaunch the bridge.
# Runs every 5 minutes via scheduled task EmetBridgeWatch (hidden, no flash).
# Deliberately does NOT touch the cloudflared tunnel service: stop-tunnel.ps1
# is the user's own "go offline" switch and must stay respected.
# Keep ASCII-only.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $root 'bridge-watch.log'

function Write-Log([string]$msg) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

$listening = $false
try {
  $conn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
  if ($conn) { $listening = $true }
} catch {}

if ($listening) {
  # Healthy: stay silent (no log spam; the log only records incidents).
  exit 0
}

Write-Log 'port 8000 not listening -> restarting bridge'
try {
  Start-Process -FilePath (Join-Path $root 'start-bridge.cmd') -WorkingDirectory $root
  Start-Sleep -Seconds 10
  $back = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
  if ($back) { Write-Log 'bridge is back (port 8000 listening)' }
  else { Write-Log 'restart attempted but port 8000 still silent - will retry next tick' }
} catch {
  Write-Log ('restart failed: ' + $_.Exception.Message)
}
