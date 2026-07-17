# Fully stop the Cloudflare tunnel (cloudflared). The bridge no longer manages
# the tunnel, so use this when you want emethome.com offline. Keep ASCII-only.
$n = (Get-Process cloudflared -ErrorAction SilentlyContinue | Measure-Object).Count
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host ""
if ($n -gt 0) { Write-Host ("Tunnel stopped (" + $n + " process). emethome.com is now offline.") }
else { Write-Host "No tunnel was running." }
Write-Host ""
