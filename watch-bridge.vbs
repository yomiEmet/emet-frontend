' Hidden launcher for watch-bridge.ps1 (window style 0 = no console flash).
' Used by scheduled task EmetBridgeWatch every 5 minutes.
Dim shell, root
Set shell = CreateObject("WScript.Shell")
root = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "watch-bridge.ps1""", 0, False
