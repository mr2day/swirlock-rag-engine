# RAG Engine Roadmap

This document tracks the work needed to move the RAG Engine from the current phase-one retrieval API
to a high-quality retrieval system.

## Current Baseline

- Contract-facing endpoint: `POST /v2/retrieval/evidence`
- Live provider: Exa search-then-extract
- Local store: file-backed JSON cache at `data/knowledge-store.json`
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

Status: not started

Goal: replace the JSON cache with a durable local store suitable for long-term retrieval and indexing.

Preferred direction:

- PostgreSQL on the dedicated 1TB SSD.
- `pgvector` for embeddings.
- PostgreSQL full-text search for lexical retrieval.
- Structured metadata tables for documents, chunks, sources, retrieval runs, and refresh state.
- Optional filesystem blob storage for large raw/extracted content keyed by content hash.

Work:

- Choose and document the PostgreSQL data directory on the 1TB SSD.
- Add database connection config and migrations.
- Model documents, chunks, sources, retrieval runs, and embeddings.
- Keep the existing JSON store only as a temporary migration/source import path if useful.
- Add backup/restore instructions before using the database as the source of truth.

Acceptance criteria:

- RAG persists documents and chunks in PostgreSQL.
- A clean machine can recreate schema through migrations.
- Local retrieval no longer depends on `data/knowledge-store.json`.

## 3. Ingestion And Indexing Pipeline

Status: not started

Goal: turn live web results and manually seeded material into normalized, deduplicated, retrievable
knowledge.

Work:

- Canonicalize URLs and source IDs.
- Hash raw and cleaned content for deduplication.
- Store extraction provenance and provider metadata.
- Chunk documents with stable chunk IDs.
- Extract title, publication time, source type, and freshness metadata.
- Add embedding jobs for new or changed chunks.
- Add refresh policy for stale or volatile sources.
- Add a seed/import command for local documents and known URLs.

Acceptance criteria:

- Repeated web results update existing records rather than creating duplicates.
- Chunks can be re-indexed deterministically after code changes.
- Failed extraction/indexing jobs are visible and retryable.

## 4. Hybrid Retrieval

Status: not started

Goal: retrieve better evidence by combining lexical matching, vector similarity, freshness, and source
quality.

Work:

- Implement PostgreSQL full-text retrieval.
- Implement vector retrieval through `pgvector`.
- Blend lexical score, vector score, freshness score, and source quality.
- Add source-quality heuristics per domain/source type.
- Add diversity selection with MMR or equivalent.
- Add reranking support, initially deterministic and later Utility LLM assisted if useful.
- Preserve evidence provenance and scores in the contract response.

Acceptance criteria:

- Retrieval can return relevant older local evidence for low-freshness queries.
- Retrieval prefers fresh/live evidence for high and realtime queries.
- Duplicate or near-duplicate chunks are suppressed.
- Result sets include source diversity when multiple sources are available.

## 5. Evaluations

Status: not started

Goal: make retrieval quality measurable before changing ranking, storage, or model-support behavior.

Work:

- Create a golden query set with expected sources or facts.
- Track recall@k for known-answer retrieval.
- Track citation/source accuracy.
- Track freshness accuracy for current events, weather, markets, and scores.
- Track latency and provider cost per retrieval mode.
- Add regression tests for known failures.
- Keep evaluation fixtures independent from private runtime cache state.

Acceptance criteria:

- A single command runs the retrieval evaluation suite.
- Evaluation output is comparable across commits.
- Ranking changes are not accepted without checking quality deltas.

## 6. Operational Hardening

Status: not started

Goal: make the service easier to run, debug, and recover locally.

Work:

- Add database migrations and migration docs.
- Add backup and restore procedure for the PostgreSQL store.
- Add structured logging for retrieval runs, provider calls, cache writes, and model-host calls.
- Add provider cost tracking for Exa search/extract usage.
- Add caller timeout handling and request budget propagation.
- Add request-size protections and service-level limits where needed.
- Add OpenAPI-generated DTO parity or schema validation when contracts stabilize.
- Add PM2 runbook notes for RAG, Utility LLM Host, and dependencies.

Acceptance criteria:

- Operators can tell whether failures come from Exa, PostgreSQL, Utility LLM Host, or request validation.
- Runtime state can be backed up and restored.
- Contract drift is caught by tests or generated validation.
