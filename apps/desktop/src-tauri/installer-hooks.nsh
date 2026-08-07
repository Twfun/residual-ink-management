; 安装/卸载前自动结束旧版本残留进程，避免文件被占用导致“无法打开要写入的文件”。
!macro NSIS_HOOK_PREINSTALL
  ; 按安装目录精确结束进程（涵盖主程序、residual-ink-api.exe、mysqld.exe、exact-bridge.exe）
  nsExec::ExecToLog "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $\"Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$INSTDIR*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\""
  ; 兜底：按进程名结束我们独有的二进制（不影响其他软件）
  nsExec::ExecToLog "taskkill /F /IM residual-ink-api.exe /T"
  nsExec::ExecToLog "taskkill /F /IM exact-bridge.exe /T"
  nsExec::ExecToLog "taskkill /F /IM 余墨管理系统.exe /T"
  nsExec::ExecToLog "taskkill /F /IM ResidualInkManagement.exe /T"
  Sleep 2000
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::ExecToLog "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command $\"Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$INSTDIR*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }$\""
  nsExec::ExecToLog "taskkill /F /IM residual-ink-api.exe /T"
  nsExec::ExecToLog "taskkill /F /IM exact-bridge.exe /T"
  nsExec::ExecToLog "taskkill /F /IM 余墨管理系统.exe /T"
  nsExec::ExecToLog "taskkill /F /IM ResidualInkManagement.exe /T"
  Sleep 2000
!macroend
