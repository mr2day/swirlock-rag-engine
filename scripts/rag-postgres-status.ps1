param(
  [string] $PostgresVersion = "17",
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
$psqlPath = Join-Path $pgRoot "bin\psql.exe"

if (-not (Test-Path $psqlPath)) {
  throw "psql.exe not found at $psqlPath"
}

$databaseUrl = [Uri](Read-RagDatabaseUrl)
$userInfo = $databaseUrl.UserInfo.Split(":", 2)
$username = [Uri]::UnescapeDataString($userInfo[0])
$password = if ($userInfo.Length -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { "" }
$databaseName = $databaseUrl.AbsolutePath.TrimStart("/")
$port = if ($databaseUrl.Port -gt 0) { $databaseUrl.Port } else { 5432 }

$env:PGPASSWORD = $password
& $psqlPath `
  -h $databaseUrl.Host `
  -p $port `
  -U $username `
  -d $databaseName `
  -At `
  -c @"
SELECT 'extensions=' || string_agg(extname, ',' ORDER BY extname) FROM pg_extension;
SELECT 'migrations=' || string_agg(version::text, ',' ORDER BY version) FROM rag_schema_migrations;
SELECT 'documents=' || count(*) FROM rag_source_documents;
SELECT 'chunks=' || count(*) FROM rag_document_chunks;
SELECT 'pending_embedding_jobs=' || count(*) FROM rag_embedding_jobs WHERE status = 'pending';
SELECT 'failed_embedding_jobs=' || count(*) FROM rag_embedding_jobs WHERE status = 'failed';
SELECT 'retrieval_runs=' || count(*) FROM rag_retrieval_runs;
"@
