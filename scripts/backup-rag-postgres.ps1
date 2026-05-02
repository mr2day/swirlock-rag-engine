param(
  [string] $PostgresVersion = "17",
  [string] $BackupDirectory = "D:\swirlock\postgresql\backups",
  [string] $EnvPath = ".env.local"
)

$ErrorActionPreference = "Stop"

function Read-RagDatabaseUrl {
  if (-not (Test-Path $EnvPath)) {
    throw "$EnvPath was not found."
  }

  $line = Get-Content $EnvPath |
    Where-Object { $_ -match "^RAG_DATABASE_URL=" } |
    Select-Object -First 1

  if (-not $line) {
    throw "RAG_DATABASE_URL was not found in $EnvPath."
  }

  return $line.Substring("RAG_DATABASE_URL=".Length)
}

$pgRoot = "C:\Program Files\PostgreSQL\$PostgresVersion"
$pgDumpPath = Join-Path $pgRoot "bin\pg_dump.exe"

if (-not (Test-Path $pgDumpPath)) {
  throw "pg_dump.exe not found at $pgDumpPath"
}

$databaseUrl = [Uri](Read-RagDatabaseUrl)
$userInfo = $databaseUrl.UserInfo.Split(":", 2)
$username = [Uri]::UnescapeDataString($userInfo[0])
$password = if ($userInfo.Length -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { "" }
$databaseName = $databaseUrl.AbsolutePath.TrimStart("/")
$port = if ($databaseUrl.Port -gt 0) { $databaseUrl.Port } else { 5432 }
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $BackupDirectory "swirlock_rag-$timestamp.dump"

New-Item -ItemType Directory -Force $BackupDirectory | Out-Null

$env:PGPASSWORD = $password
& $pgDumpPath `
  -h $databaseUrl.Host `
  -p $port `
  -U $username `
  -d $databaseName `
  -F c `
  -f $backupPath

Write-Output "RAG PostgreSQL backup written to $backupPath"
