# Atrium 실제 판 바로가기 만들기(P9, P18에 이름을 바꿈). 바로가기는 real.cmd를 최소화한 콘솔로 부르고, real.cmd가 창을 띄운 뒤 콘솔은 닫힌다.
# 쓰는 법: powershell -ExecutionPolicy Bypass -File app\scripts\make-shortcut.ps1 [-Dest <폴더>] [-Name Atrium] [-Icon <.ico 또는 exe,번호>]
# -Dest를 빼면 사용자 바탕화면에 만든다. 시험은 -Dest로 시험 폴더를 준다
# P69: -Target으로 설치 폴더의 실행기(Atrium.cmd)를 주면 바로가기가 설치 폴더의 지금 버전을 띄운다(atrium install이 준다). -WorkDir를 빼면 Target의 폴더
param(
  [string]$Dest = [Environment]::GetFolderPath('Desktop'),
  [string]$Name = 'Atrium',
  [string]$Icon = '',
  [string]$Target = '',
  [string]$WorkDir = ''
)
$ErrorActionPreference = 'Stop'
$scripts = $PSScriptRoot
$appRoot = Split-Path -Parent $scripts
$target = if ($Target) { $Target } else { Join-Path $scripts 'real.cmd' }
if (-not (Test-Path $target)) { throw "실행할 파일이 없다: $target" }
if (-not $WorkDir) { $WorkDir = if ($Target) { Split-Path -Parent $target } else { $appRoot } }
if (-not (Test-Path $Dest -PathType Container)) { throw "폴더가 없다: $Dest" }
# 아이콘: 준 것 → app\assets\icon.ico → Electron 실행 파일의 아이콘 → 없으면 기본
if (-not $Icon) {
  $ico = Join-Path $appRoot 'assets\icon.ico'
  $exe = Join-Path $appRoot 'node_modules\electron\dist\electron.exe'
  if (Test-Path $ico) { $Icon = $ico } elseif (Test-Path $exe) { $Icon = "$exe,0" }
}
$lnk = Join-Path $Dest "$Name.lnk"
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = $target
$s.Arguments = ''
$s.WorkingDirectory = $WorkDir
$s.WindowStyle = 7 # 최소화
$s.Description = 'Atrium 실제 판(herdr 세션 atrium)'
if ($Icon) { $s.IconLocation = $Icon }
$s.Save()
Write-Output $lnk
