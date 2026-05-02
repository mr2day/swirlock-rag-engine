# RAG Engine Roadmap

This document tracks the work needed to move the RAG Engine from the current phase-one retrieval API
to a high-quality retrieval system.

## Current Baseline

- Contract-facing endpoint: `POST /v2/retrieval/evidence`
- Live provider: Exa search-then-extract
- Local store: PostgreSQL when `RAG_DATABASE_URL` is configured, with JSON fallback for no-database development/test runs
- Retrieval policy: deterministic local/live routing
- Local HTTP binding: `127.0.0.1:3001`
- Utility LLM Host: called over the v2 WebSocket inference stream for retrieval support

## 1. Utility LLM Host Client

Status: implemented in phase one

Goal: let RAG use the local Utility LLM Host for retrieval-support inference while keeping model
hosting separate from retrieval ownership.

Work:

- [x] Add `UTILITY_LLM_HOST_URL` to `service.config.cjs`.
- [x] Add a typed Model Host WebSocket client for `WS /v2/infer/stream`.
- [x] Add health/readiness diagnostics for the configured Utility LLM Host.
- [x] Add timeout, retry, and degraded-mode behavior.
- [x] Add prompts for query rewriting and intent clarification.
- [x] Add prompts for image observations from `imageUrl`.
- [x] Add prompts for extraction summaries and evidence shaping.
- [x] Keep RAG responsible for final retrieval decisions; the model host only returns support text.
- [ ] Add shared media resolution so `imageId` can be sent to the model host.

Acceptance criteria:

- [x] RAG can call the Utility LLM Host on `127.0.0.1:3000` in local development.
- [x] Retrieval still works without the Utility LLM Host, with clear diagnostics.
- [x] Unit tests cover success, timeout, malformed response, and unavailable-host paths.

## 2. Durable Knowledge Store

Status: implemented for the local runtime baseline

Goal: replace the JSON cache with a durable local store suitable for long-term retrieval and indexing.

Preferred direction:

- PostgreSQL on the dedicated 1TB SSD.
- `pgvector` for embeddings.
- PostgreSQL full-text search for lexical retrieval.
- Structured metadata tables for documents, chunks, sources, retrieval runs, and refresh state.
- Optional filesystem blob storage for large raw/extracted content keyed by content hash.

Work:

- [x] Choose and document the PostgreSQL tablespace on the 1TB SSD.
- [x] Use `scripts/install-pgvector-windows.ps1` to build and install pgvector for local PostgreSQL.
- [x] Use `scripts/setup-rag-postgres.ps1` for local PostgreSQL role, database, tablespace, extension, and `.env.local` setup.
- [x] Add database connection config and service-managed migrations.
- [x] Model documents, chunks, retrieval runs, lexical search vectors, and future embedding fields.
- [x] Keep the existing JSON store only as a no-database fallback.
- [ ] Add backup/restore instructions before using the database as the long-term source of truth.
- [ ] Add an import path for any useful existing `data/knowledge-store.json` content.

Acceptance criteria:

- [x] RAG persists documents and chunks in PostgreSQL.
- [x] A clean machine can recreate schema through migrations.
- [x] Local retrieval no longer depends on `data/knowledge-store.json` when `RAG_DATABASE_URL` is configured.

## 3. Ingestion And Indexing Pipeline

Status: baseline implemented

Goal: turn live web results and manually seeded material into normalized, deduplicated, retrievable
knowledge.

Work:

- [x] Canonicalize URLs and source IDs.
- [x] Hash raw and cleaned content for deduplication.
- [x] Store extraction provenance and provider metadata.
- [x] Chunk documents with stable chunk IDs.
- [x] Extract title, publication time, source type, and freshness metadata.
- [x] Add embedding jobs for new or changed chunks.
- [x] Add refresh policy for stale or volatile sources.
- [x] Add a JSON cache import command.
- [ ] Add a seed/import command for arbitrary local documents and known URLs.

Acceptance criteria:

- [x] Repeated web results update existing records rather than creating duplicates.
- [x] Chunks can be re-indexed deterministically after code changes.
- [x] Failed embedding/indexing work is visible through `rag_embedding_jobs`.
- [ ] Failed provider extraction jobs are persisted separately from retrieval diagnostics.

## 4. Hybrid Retrieval

Status: partial baseline implemented

Goal: retrieve better evidence by combining lexical matching, vector similarity, freshness, and source
quality.

Work:

- [x] Implement PostgreSQL full-text retrieval.
- [ ] Implement vector retrieval through `pgvector`; blocked until the Embedding Service contract/worker exists.
- [x] Blend lexical/trigram score, freshness score, and source quality.
- [x] Add source-quality heuristics per domain/source type.
- [x] Add diversity selection with an MMR-style domain penalty.
- [ ] Add reranking support, initially deterministic and later Utility LLM assisted if useful.
- [x] Preserve evidence provenance and scores in the contract response.

Acceptance criteria:

- [x] Retrieval can return relevant older local evidence for low-freshness queries.
- [x] Retrieval prefers fresh/live evidence for high and realtime queries.
- [x] Duplicate or near-duplicate chunks are suppressed.
- [x] Result sets include source diversity when multiple sources are available.
- [ ] Vector similarity contributes to ranking once embeddings are produced.

## 5. Evaluations

Status: baseline implemented

Goal: make retrieval quality measurable before changing ranking, storage, or model-support behavior.

Work:

- [x] Create a golden query set with expected sources or facts.
- [x] Track recall@k for known-answer retrieval.
- [x] Track citation/source accuracy through expected source URLs.
- [x] Track freshness-sensitive query behavior in the starter fixture.
- [x] Track latency for the isolated local evaluation command.
- [ ] Track provider cost per retrieval mode.
- [ ] Add broader regression tests for known failures.
- [x] Keep evaluation fixtures independent from private runtime cache state.

Acceptance criteria:

- [x] A single command runs the retrieval evaluation suite: `npm run eval:retrieval`.
- [x] Evaluation output is comparable across commits.
- [ ] Ranking changes are not accepted without checking quality deltas in CI.

## 6. Operational Hardening

Status: partial baseline implemented

Goal: make the service easier to run, debug, and recover locally.

Work:

- [x] Add database migrations and migration docs.
- [x] Add backup and restore procedure for the PostgreSQL store.
- [x] Add PostgreSQL status script for migrations, document/chunk counts, embedding jobs, and retrieval runs.
- [x] Add PM2 runbook notes for RAG, Utility LLM Host, and dependencies.
- [ ] Add structured logging for retrieval runs, provider calls, cache writes, and model-host calls.
- [ ] Add provider cost tracking for Exa search/extract usage.
- [ ] Add caller timeout handling and request budget propagation.
- [ ] Add request-size protections and service-level limits where needed.
- [ ] Add OpenAPI-generated DTO parity or schema validation when contracts stabilize.

Acceptance criteria:

- [x] Operators can tell whether failures come from Exa, PostgreSQL, Utility LLM Host, or request validation.
- [x] Runtime state can be backed up and restored.
- [ ] Contract drift is caught by tests or generated validation.
