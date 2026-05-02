# RAG Operations

## Health Checks

Use the service health endpoint first:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/v2/health
```

`data.knowledgeStore.ready` identifies PostgreSQL availability. `data.providers.exaConfigured`
identifies whether live web retrieval can run. `data.providers.utilityLlm` identifies whether the
Utility LLM Host is configured and reachable.

For direct PostgreSQL visibility:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\rag-postgres-status.ps1
```

Expected local extensions are `citext`, `pg_trgm`, `plpgsql`, `unaccent`, and `vector`.

## Migrations

The RAG Engine owns its internal schema migrations. Migrations run from the application process when
the PostgreSQL-backed knowledge store is first used.

The schema migration table is:

```text
rag_schema_migrations
```

Current migrations:

- `1` creates source documents, document chunks, retrieval runs, full-text indexes, and future vector fields.
- `2` adds canonical URLs, source domains, refresh metadata, chunk offsets, source-quality scores, and embedding jobs.

## Backup

Back up the local RAG store before schema work, large imports, or long unattended experiments:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup-rag-postgres.ps1
```

Backups are written to:

```text
D:\swirlock\postgresql\backups
```

The backup format is PostgreSQL custom format (`pg_dump -F c`).

## Restore

Restoring is intentionally manual because it can replace local runtime state.

1. Stop the RAG Engine process if it is running.
2. Confirm the backup path.
3. Restore with `pg_restore` from an Administrator PowerShell:

```powershell
$env:PGPASSWORD = "<password from .env.local>"
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" `
  -h 127.0.0.1 `
  -p 5432 `
  -U swirlock_rag `
  -d swirlock_rag `
  --clean `
  --if-exists `
  "D:\swirlock\postgresql\backups\swirlock_rag-YYYYMMDD-HHMMSS.dump"
```

4. Run `scripts\rag-postgres-status.ps1`.
5. Restart the RAG Engine.

## PM2

Build and start the RAG Engine under PM2:

```powershell
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

After code or config changes:

```powershell
npm run build
pm2 restart ecosystem.config.cjs --update-env
pm2 save
```

Check local services:

```powershell
pm2 status
pm2 logs swirlock-rag-engine
pm2 logs swirlock-llm-host
```

## Failure Triage

PostgreSQL failures usually show up as `knowledgeStore.ready: false` in `/v2/health` or warnings
about persistence after live retrieval. Run `scripts\rag-postgres-status.ps1` next.

Exa failures show up as `liveSearchError` or `exaConfigured: false`. Local-only retrieval can still
work when PostgreSQL has useful evidence.

Utility LLM Host failures show up under `providers.utilityLlm` in health and under
`retrievalDiagnostics.utilityLlm.calls` in retrieval responses. Retrieval degrades to deterministic
query handling when Utility LLM support is unavailable.

Embedding jobs are queued in `rag_embedding_jobs`. They are expected to remain pending until an
Embedding Service contract and worker are implemented.
