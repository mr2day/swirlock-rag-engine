param(
  [string] $PostgresVersion = "17",
  [string] $PgvectorVersion = "v0.8.2",
  [switch] $InstallBuildTools
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)

  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell window."
  }
}

function Find-VsDevCmd {
  $roots = @(
    "C:\Program Files\Microsoft Visual Studio\2022",
    "C:\Program Files (x86)\Microsoft Visual Studio\2022"
  )

  $candidates = $roots |
    Where-Object { Test-Path $_ } |
    ForEach-Object {
      Get-ChildItem `
        $_ `
        -Recurse `
        -Filter VsDevCmd.bat `
        -ErrorAction SilentlyContinue
    }

  return $candidates | Select-Object -First 1 -ExpandProperty FullName
}

Assert-Admin

$pgRoot = "C:\Program Files\PostgreSQL\$PostgresVersion"
$vectorControl = Join-Path $pgRoot "share\extension\vector.control"

if (Test-Path $vectorControl) {
  Write-Output "pgvector is already installed at $vectorControl"
  exit 0
}

$vsDevCmd = Find-VsDevCmd

if (-not $vsDevCmd -and $InstallBuildTools) {
  Write-Output "Installing Visual Studio C++ Build Tools..."

  winget install `
    --id Microsoft.VisualStudio.2022.BuildTools `
    -e `
    --disable-interactivity `
    --accept-package-agreements `
    --accept-source-agreements `
    --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

  $vsDevCmd = Find-VsDevCmd
}

if (-not $vsDevCmd) {
  throw @"
Visual Studio C++ Build Tools were not found.

Install them first from an elevated PowerShell:

winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Then rerun:

powershell -ExecutionPolicy Bypass -File scripts\install-pgvector-windows.ps1
"@
}

$workDir = Join-Path $env:TEMP "pgvector-$PgvectorVersion"
if (Test-Path $workDir) {
  Remove-Item -LiteralPath $workDir -Recurse -Force
}

git clone --branch $PgvectorVersion https://github.com/pgvector/pgvector.git $workDir

$command = @"
call "$vsDevCmd" -arch=x64 -host_arch=x64
set "PGROOT=$pgRoot"
cd /d "$workDir"
nmake /F Makefile.win
nmake /F Makefile.win install
"@

$cmdPath = Join-Path $env:TEMP "install-pgvector-$PgvectorVersion.cmd"
Set-Content -LiteralPath $cmdPath -Value $command -Encoding ascii
cmd /c "`"$cmdPath`""

if (-not (Test-Path $vectorControl)) {
  throw "pgvector build completed, but vector.control was not found at $vectorControl"
}

Write-Output "pgvector installed at $vectorControl"
