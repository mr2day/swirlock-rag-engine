# Swirlock RAG Engine

Retrieval and evidence service for the Swirlock chatbot ecosystem.

## Purpose

Swirlock RAG Engine is responsible for finding, storing, reusing, and shaping external knowledge.

Its job is to:

- search the live web
- maintain a local web-derived knowledge store built from prior retrieval work
- decide whether a query should use local retrieval, live web retrieval, or both
- return structured evidence for downstream systems

This service exists to provide grounded external knowledge, not to manage the whole chatbot.

## Role In The Ecosystem

This repository contains the RAG Engine only.

In the wider Swirlock chatbot architecture, this service works alongside:

- Chat Orchestrator
- Context Fragmenter
- Primary LLM Host
- Utility LLM Host
- Embedding Service

The RAG Engine owns retrieval semantics.
It does not own memory semantics, context-window management, or final answer generation.

## What This Service Does

The RAG Engine:

- accepts text, image, or multimodal retrieval input
- can call the Utility LLM Host over the v2 WebSocket inference stream for retrieval-support tasks
- can call the Embedding Service over HTTP for query and document vectorization
- normalizes text retrieval queries with Utility LLM support and deterministic fallback
- chooses a retrieval mode using deterministic phase-one policy
- searches a local knowledge store with lexical/vector hybrid retrieval, the live web, or both
- ranks, filters, and packages evidence
- optionally produces an evidence-oriented synthesis for downstream use

## What This Service Does Not Do

The RAG Engine does not:

- manage tenant context
- manage user memory or app memory
- implement fragmented context or sleep
- assemble the final context window for the primary LLM
- generate the final chatbot answer as the system of record
- host the primary answering model

Those concerns belong to other services in the Swirlock chatbot ecosystem.

## Retrieval Model

The RAG Engine is designed as a web-backed retrieval system with a persistent local cache / knowledge store.

Its local database is intended to accumulate:

- prior search results
- fetched web pages and extracted content
- normalized retrieval artifacts
- indexing metadata
- provenance and freshness metadata

This local store is not the chatbot's memory system.
It is a retrieval knowledge base derived from web activity.

## Retrieval Modes

Each request is routed into one of these modes:

- `none`
- `local_rag`
- `live_web`
- `local_and_live`

The routing decision should reflect:

- query intent
- freshness requirements
- confidence in local coverage
- whether external live information is needed

## Multimodal Input

The engine accepts:

- text
- images
- combined text and image input

Phase one accepts image references in the contract shape.
Image URLs can be sent to the Utility LLM Host for retrieval-oriented observations.
Image IDs still require a future shared media resolver before RAG can send image bytes or URLs to the model host.

## Output

The engine returns structured evidence for downstream systems such as the Chat Orchestrator or Context Fragmenter.

Expected output elements include:

- normalized query information
- search queries used
- evidence chunks
- source metadata
- relevance scores
- optional freshness information
- optional evidence synthesis

The result should be suitable for downstream context assembly, answer generation, or external API delivery.

## Canonical Boundaries

The canonical ecosystem architecture and cross-service contracts are maintained outside this repository in the `swirlock-chatbot-contracts` repository.

That repository is the single source of truth for cross-service contracts.

This repository should stay focused on the RAG Engine implementation and its own internal design.

## Local Configuration

The app uses `service.config.cjs` as the committed source of truth for local runtime settings such as host, port, retrieval limits, and fallback knowledge-store path.

Secrets may still come from `.env.local`, `.env`, or process environment. For local testing, create a `.env` file based on `.env.example`:

```env
EXA_API_KEY=your_exa_key
RAG_DATABASE_URL=postgresql://swirlock_rag:password@127.0.0.1:5432/swirlock_rag
```

The preferred local knowledge store is PostgreSQL with `pgvector`:

```text
Database: swirlock_rag
Role: swirlock_rag
Tablespace: D:\swirlock\postgresql\tablespaces\rag_knowledge
Extensions: vector, pg_trgm, unaccent, citext
```

Use these scripts from an Administrator PowerShell to prepare a Windows machine:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-pgvector-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\setup-rag-postgres.ps1
```

`setup-rag-postgres.ps1` creates or updates `.env.local` with `RAG_DATABASE_URL`. The password in that file is a local secret and is ignored by git.

If `RAG_DATABASE_URL` is not configured, the service falls back to a development JSON store:

```text
data/knowledge-store.json
```

`data/` is ignored by git because it is runtime retrieval state. The JSON path is now a fallback, not the preferred runtime store.

The default local HTTP binding is:

```text
127.0.0.1:3001
```

Utility LLM support is configured in `service.config.cjs`:

```text
UTILITY_LLM_ENABLED=true
UTILITY_LLM_HOST_URL=http://127.0.0.1:3213
UTILITY_LLM_TIMEOUT_MS=30000
UTILITY_LLM_RETRIES=1
```

Embedding support is also configured in `service.config.cjs`:

```text
EMBEDDING_SERVICE_ENABLED=true
EMBEDDING_SERVICE_URL=http://127.0.0.1:3002
EMBEDDING_SERVICE_MODEL_ID=bge-small-en-v1.5
EMBEDDING_SERVICE_DIMENSIONS=384
EMBEDDING_WORKER_ENABLED=true
```

The Embedding Service must be backed by the CPU-only `llama-server-embedding`
PM2 process on `127.0.0.1:8081`; the RAG Engine calls only the Embedding
Service contract on `127.0.0.1:3002`.

## Contract API

The phase-one contract endpoint is:

- `POST /v2/retrieval/evidence`

All contract calls require:

- `x-correlation-id`
- a JSON body with `requestContext` and `query`

The endpoint returns the common contract envelope:

```json
{
  "meta": {
    "requestId": "0196f9e8-71b6-7dc0-8d2c-b0b3c4567890",
    "correlationId": "turn-123",
    "apiVersion": "v2",
    "servedAt": "2026-05-01T12:00:00.000Z"
  },
  "data": {
    "normalizedQuery": {},
    "searchQueries": [],
    "evidenceChunks": [],
    "retrievalDiagnostics": {}
  }
}
```

The service also exposes:

- `GET /v2/health`

Useful local maintenance commands:

```powershell
npm run knowledge:import-json
npm run eval:retrieval
powershell -ExecutionPolicy Bypass -File scripts\rag-postgres-status.ps1
powershell -ExecutionPolicy Bypass -File scripts\backup-rag-postgres.ps1
```

See `docs/RAG_OPERATIONS.md` for migration, backup, restore, PM2, and failure-triage notes.

For local process management:

```powershell
npm run build
pm2 start ecosystem.config.cjs
```

## Diagnostic UI

The diagnostic search UI is available at:

- `http://127.0.0.1:3001/dev/search/ui`

The diagnostic JSON routes are:

- `GET /dev/search?q=your+query`
- `GET /dev/search/extract?q=your+query&searchLimit=5&extractLimit=3`

The UI supports two diagnostic flows:

- Exa search
- Exa search-then-extract inspection

When you start the server manually, search and extraction stages are logged in the Nest server console before dispatch and after completion.

## Current Status

This repository is in phase-one implementation.

It currently contains:

- a NestJS service scaffold
- Exa live search and extract diagnostics
- a `v2` contract-facing retrieval endpoint
- a Utility LLM Host WebSocket client for query support, image observations, extraction summaries, and evidence shaping
- an Embedding Service HTTP client for v3-contract vectorization calls
- a background embedding worker that drains `rag_embedding_jobs` and writes `pgvector` embeddings
- a PostgreSQL-backed local web-derived knowledge store with canonical URLs, chunking, full-text indexes, refresh metadata, embedding jobs, and `pgvector` embeddings
- baseline hybrid local retrieval that fuses PostgreSQL full-text/trigram ranking with vector similarity, freshness, source quality, and source diversity
- deterministic retrieval-mode routing
- evidence packaging and lightweight retrieval synthesis
- a baseline golden-query retrieval evaluation command
- unit coverage for query resolution, ranking, cache persistence, retrieval policy, and contract retrieval behavior

The remaining larger pieces are shared media resolution for `imageId`, stronger reranking, provider-cost tracking, contract-generated validation, broader e2e contract coverage, and a larger retrieval evaluation corpus.
