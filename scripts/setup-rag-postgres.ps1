param(
  [string] $PostgresVersion = "17",
  [string] $ServiceName = "postgresql-x64-17",
  [string] $TablespaceDirectory = "D:\swirlock\postgresql\tablespaces\rag_knowledge",
  [string] $DatabaseName = "swirlock_rag",
  [string] $RoleName = "swirlock_rag",
  [string] $RagPassword = "",
  [switch] $SkipTemporaryTrust
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)

  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell window."
  }
}

function New-Password {
  $bytes = [byte[]]::new(24)
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()

  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }

  return [Convert]::ToBase64String($bytes).TrimEnd("=") -replace "\+", "A" -replace "/", "b"
}

function Convert-ToDatabaseUrlPassword([string] $Value) {
  return [Uri]::EscapeDataString($Value)
}

function Invoke-Psql([string] $Sql, [string] $Database = "postgres") {
  & $script:PsqlPath `
    -h 127.0.0.1 `
    -p 5432 `
    -U postgres `
    -d $Database `
    -v ON_ERROR_STOP=1 `
    -c $Sql
}

function Invoke-PsqlScalar([string] $Sql, [string] $Database = "postgres") {
  & $script:PsqlPath `
    -h 127.0.0.1 `
    -p 5432 `
    -U postgres `
    -d $Database `
    -v ON_ERROR_STOP=1 `
    -At `
    -c $Sql
}

function Write-EnvLocal([string] $DatabaseUrl) {
  $envPath = Join-Path (Resolve-Path ".").Path ".env.local"
  $lines = @()

  if (Test-Path $envPath) {
    $lines = Get-Content $envPath | Where-Object { $_ -notmatch "^RAG_DATABASE_URL=" }
  }

  $lines += "RAG_DATABASE_URL=$DatabaseUrl"
  Set-Content -LiteralPath $envPath -Value $lines -Encoding utf8
}

Assert-Admin

$pgRoot = "C:\Program Files\PostgreSQL\$PostgresVersion"
$script:PsqlPath = Join-Path $pgRoot "bin\psql.exe"
$pgCtlPath = Join-Path $pgRoot "bin\pg_ctl.exe"
$dataDir = Join-Path $pgRoot "data"
$hbaPath = Join-Path $dataDir "pg_hba.conf"
$vectorControl = Join-Path $pgRoot "share\extension\vector.control"

if (-not (Test-Path $script:PsqlPath)) {
  throw "psql.exe not found at $script:PsqlPath"
}

if (-not (Test-Path $vectorControl)) {
  throw @"
pgvector is not installed for PostgreSQL $PostgresVersion.

Install pgvector first, then rerun this script. Official Windows build flow:
1. Install Visual Studio 2022 Build Tools with C++ support.
2. Open 'x64 Native Tools Command Prompt for VS 2022' as Administrator.
3. Run:
   set "PGROOT=$pgRoot"
   cd %TEMP%
   git clone --branch v0.8.2 https://github.com/pgvector/pgvector.git
   cd pgvector
   nmake /F Makefile.win
   nmake /F Makefile.win install
"@
}

if (-not $RagPassword) {
  $RagPassword = New-Password
}

$hbaBackup = "$hbaPath.codex-backup-$(Get-Date -Format yyyyMMddHHmmss)"

if (-not $SkipTemporaryTrust) {
  Copy-Item -LiteralPath $hbaPath -Destination $hbaBackup
  $original = [IO.File]::ReadAllText($hbaPath)
  $temporaryTrust = @"
# Temporary local setup access inserted by scripts/setup-rag-postgres.ps1.
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust

"@
  [IO.File]::WriteAllText($hbaPath, $temporaryTrust + $original, [Text.UTF8Encoding]::new($false))
  Restart-Service $ServiceName
}

try {
  New-Item -ItemType Directory -Force $TablespaceDirectory | Out-Null
  icacls $TablespaceDirectory /grant "NT AUTHORITY\NETWORK SERVICE:(OI)(CI)F" | Out-Null

  $escapedPassword = $RagPassword.Replace("'", "''")
  $escapedTablespaceDirectory = $TablespaceDirectory.Replace("\", "/").Replace("'", "''")

  Invoke-Psql @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RoleName') THEN
    CREATE ROLE $RoleName LOGIN PASSWORD '$escapedPassword';
  ELSE
    ALTER ROLE $RoleName LOGIN PASSWORD '$escapedPassword';
  END IF;
END
`$`$;
"@

  $tablespaceExists = Invoke-PsqlScalar "SELECT 1 FROM pg_tablespace WHERE spcname = '${RoleName}_ts';"
  if ($tablespaceExists -ne "1") {
    Invoke-Psql "CREATE TABLESPACE ${RoleName}_ts OWNER $RoleName LOCATION '$escapedTablespaceDirectory';"
  }

  $databaseExists = Invoke-PsqlScalar "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName';"
  if ($databaseExists -ne "1") {
    Invoke-Psql "CREATE DATABASE $DatabaseName OWNER $RoleName TABLESPACE ${RoleName}_ts;"
  }

  Invoke-Psql "CREATE EXTENSION IF NOT EXISTS vector;" $DatabaseName
  Invoke-Psql "CREATE EXTENSION IF NOT EXISTS pg_trgm;" $DatabaseName
  Invoke-Psql "CREATE EXTENSION IF NOT EXISTS unaccent;" $DatabaseName
  Invoke-Psql "CREATE EXTENSION IF NOT EXISTS citext;" $DatabaseName

  $databaseUrl = "postgresql://${RoleName}:$(Convert-ToDatabaseUrlPassword $RagPassword)@127.0.0.1:5432/$DatabaseName"
  Write-EnvLocal $databaseUrl

  Write-Output "PostgreSQL RAG database is ready."
  Write-Output "Database: $DatabaseName"
  Write-Output "Role: $RoleName"
  Write-Output "Tablespace directory: $TablespaceDirectory"
  Write-Output ".env.local updated with RAG_DATABASE_URL"
} finally {
  if (-not $SkipTemporaryTrust -and (Test-Path $hbaBackup)) {
    Copy-Item -LiteralPath $hbaBackup -Destination $hbaPath -Force
    Restart-Service $ServiceName
    Write-Output "Restored pg_hba.conf from $hbaBackup"
  }
}
