# Start the Cloudflare tunnel service -> emethome.com comes online.
# Normally not needed (the service auto-starts on boot); use only after you ran
# stop-tunnel.ps1. Keep ASCII-only.
$svc = Get-Service -Name cloudflared -ErrorAction SilentlyContinue
if ($svc) {
  Start-Service -Name cloudflared -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  $svc.Refresh()
  Write-Host ""
  Write-Host ("Tunnel service status: " + (Get-Service -Name cloudflared).Status)
  Write-Host "emethome.com should be back online in a few seconds."
} else {
  Write-Host "Tunnel service not installed. Ask CC to reinstall it."
}
Write-Host ""
