# Swirlock RAG Engine

Retrieval service for the Swirlock ecosystem. Owns local knowledge search,
live web search (Exa + Wikipedia), evidence packaging, and citation data.
The ecosystem API is WebSocket-only (Swirlock Contracts v4 today; v5 is the
forward target — see "Contract version" below).

## What this service depends on

These are runtime requirements. You **must** have all of them before the
service will start cleanly.

| Dependency | What for | Default |
| --- | --- | --- |
| **PostgreSQL 14+ with `pgvector`, `pg_trgm`, `unaccent`, `citext` extensions** | Persistent local knowledge store with hybrid lexical + vector search | `127.0.0.1:5432`, db `swirlock_rag`, role `swirlock_rag` |
| **Swirlock LLM Host** (peer ecosystem service) | Query refinement, extraction summaries, document-retention decisions | `http://127.0.0.1:3213` |
| **Swirlock Embedding Service** (peer ecosystem service) | Vector embeddings for the local knowledge store and query embeddings | `http://127.0.0.1:3002` |
| **Exa API key** | Live web search and content extraction | Required for live retrieval; service runs without it but live search is disabled |

If any of these are missing, the service starts in a degraded state and the
diagnostic endpoints (see "Endpoints" below) will report which dependency
is missing.

## Install

### 1. Node dependencies

```powershell
npm install
```

### 2. PostgreSQL with pgvector (Windows)

The repo ships scripts that do the full local setup:

```powershell
# Install pgvector into your PostgreSQL installation (run from elevated PowerShell)
powershell -ExecutionPolicy Bypass -File scripts\install-pgvector-windows.ps1

# Create the swirlock_rag database, role, tablespace, and required extensions
powershell -ExecutionPolicy Bypass -File scripts\setup-rag-postgres.ps1

# Verify
powershell -ExecutionPolicy Bypass -File scripts\rag-postgres-status.ps1
```

`setup-rag-postgres.ps1` prints the connection string at the end. Save it —
you'll paste it into `.env.local` next.

If you're running PostgreSQL on a different host, port, or database, or
already have `swirlock_rag` provisioned, skip the scripts and provide your
own `RAG_DATABASE_URL`.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in the two required values:

```ini
# .env.local — gitignored, machine-specific
EXA_API_KEY=your-exa-api-key
RAG_DATABASE_URL=postgres://swirlock_rag:<password>@127.0.0.1:5432/swirlock_rag
```

`.env.local` overrides `.env` and is loaded automatically at startup.

### 4. Build

```powershell
npm run build
```

## Run

### Development

```powershell
npm run start:dev
```

### Production (PM2)

The repo includes `ecosystem.config.cjs` so PM2 picks up the right
service name, working directory, and environment from `service.config.cjs`:

```powershell
pm2 start ecosystem.config.cjs
pm2 save
```

After code changes:

```powershell
npm run build
pm2 restart swirlock-rag-engine --update-env
pm2 save
```

## Configuration

Two layers, both committed to the repo as defaults:

- **`service.config.cjs`** — runtime defaults: port (3001), host
  (127.0.0.1), upstream URLs, embedding-worker tuning, Wikipedia
  provider settings, RAG result limits. Edit in place to change defaults.
- **`.env.local`** — machine-specific secrets (`EXA_API_KEY`,
  `RAG_DATABASE_URL`). Gitignored.

Every value in `service.config.cjs` may be overridden by an environment
variable of the same name (the file enumerates them under `buildEnv`).
PM2 receives the full env from `service.config.cjs::env` via
`ecosystem.config.cjs`.

## Endpoints

### WebSocket (the ecosystem contract)

```text
WS /v5/retrieval
```

Client message types:

- `retrieve_evidence`
- `health.get`
- `cancel`
- `heartbeat`

Retrieval progress is emitted as v4 envelope messages whose `type` is the
retrieval event name, including:

- `retrieval.started`
- `utility_llm.retrieval_support.started` / `.completed`
- `query.normalized`
- `embedding.query.started` / `.completed`
- `local.search.started` / `.completed`
- `retrieval.policy.decided`
- `live.search.started` / `.completed` (fires once per provider — Exa and
  Wikipedia — with `data.provider` discriminator)
- `live.extract.started` / `.completed`
- `utility_llm.extraction_summaries.started` / `.completed`
- `utility_llm.document_retention.started` / `.completed`
- `evidence.chunk`
- `retrieval.completed`
- `retrieval.failed`

Each event payload contains `sequence`, `occurredAt`, and `data`.

There are no ecosystem REST endpoints in v4.

### Diagnostics (local-ops only — not part of the ecosystem contract)

The service mounts a small set of HTTP endpoints under `/dev/*` for local
inspection (browseable retrieval test page at `/dev/search/ui`). These are
deployment-local diagnostics; do not depend on them from other services.

## Upstream Connections

The RAG Engine keeps persistent WebSockets to:

- Swirlock LLM Host: `/v5/model`
- Swirlock Embedding Service: `/v5/embeddings`

It also calls Exa's HTTPS API directly when live web search is enabled and
an `EXA_API_KEY` is present.

## Storage Layout

The local knowledge store is **PostgreSQL with pgvector**. The schema and
all migrations are defined in
`src/retrieval/knowledge-store.schema.ts` and applied automatically at
startup by `KnowledgeStoreService`. Key tables:

- `rag_source_documents` — one row per ingested source (article, page, etc.)
- `rag_document_chunks` — chunked content with `tsvector` lexical index
  and `vector` embedding column
- `rag_embedding_jobs` — async work queue drained by the embedding worker
- `rag_retrieval_runs` — diagnostic trail of past retrieval calls

Required PostgreSQL extensions: `vector`, `pg_trgm`, `unaccent`, `citext`.

The `runtime.knowledgeStorePath` field in `service.config.cjs` points at a
JSON file used by an old import path (`scripts/import-json-knowledge-store.ts`)
and is not the live store. The live store is PostgreSQL.

## Health Check

```powershell
# WS health (canonical):
# Send { "type": "health.get", "correlationId": "..." } over /v5/retrieval

# Local diagnostic (HTTP, dev only):
Invoke-RestMethod http://127.0.0.1:3001/dev/health   # if exposed
```

The WS `health` event payload reports the readiness of the knowledge store,
LLM Host, Embedding Service, and Exa configuration.

## Tests and Lint

```powershell
npm test
npm run lint
```

## Contract version

This service serves Swirlock Contracts **v5** (endpoint
`/v5/retrieval` and the `/v5/model` + `/v5/embeddings` upstream sockets).
The wire format and message types are identical to v4 — only the
endpoint paths changed.

## Companion Docs

- `docs/PHASE1.md` — historical implementation notes from the v3→v4
  transition. May reference older endpoint paths.
- `docs/RAG_OPERATIONS.md` — operations playbook. Some HTTP diagnostic
  paths described there are stale; this README is the current source of
  truth for endpoints.
- `docs/RAG_ENGINE_ROADMAP.md` — forward roadmap.
