# Stop the Cloudflare tunnel service -> emethome.com goes offline.
# The bridge (local chat) is unaffected. Keep ASCII-only.
# Note: the tunnel is a Windows service (auto-starts on boot). Stopping it here
# keeps it stopped until you run start-tunnel.ps1 or reboot.
$svc = Get-Service -Name cloudflared -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service -Name cloudflared -Force -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "Tunnel service stopped. emethome.com is now offline."
  Write-Host "(It will start again on next reboot, or run start-tunnel.ps1.)"
} else {
  # Fallback: no service, kill any stray process
  Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host "No tunnel service found; killed any stray cloudflared process."
}
Write-Host ""
