; Kill lingering app processes before install/uninstall so locked files do not
; break the update. Order: path-based sweep first (covers mysqld.exe and any
; helper under $INSTDIR), then name-based kills for our unique binaries.
!macro NSIS_HOOK_PREINSTALL
  nsExec::ExecToLog "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $\"Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$INSTDIR*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\""
  nsExec::ExecToLog "taskkill /F /IM residual-ink-management.exe /T"
  nsExec::ExecToLog "taskkill /F /IM residual-ink-api.exe /T"
  nsExec::ExecToLog "taskkill /F /IM exact-bridge.exe /T"
  nsExec::ExecToLog "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $\"Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$INSTDIR*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\""
  Sleep 3000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $\"Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$INSTDIR*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\""
  nsExec::ExecToLog "taskkill /F /IM residual-ink-management.exe /T"
  nsExec::ExecToLog "taskkill /F /IM residual-ink-api.exe /T"
  nsExec::ExecToLog "taskkill /F /IM exact-bridge.exe /T"
  nsExec::ExecToLog "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $\"Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$INSTDIR*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\""
  Sleep 3000
!macroend