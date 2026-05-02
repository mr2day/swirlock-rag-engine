# Phase 1 Notes

## Development State

The RAG Engine now has a contract-facing `v2` retrieval endpoint plus the older diagnostic Exa UI.

Implemented:

- `POST /v2/retrieval/evidence`
- `GET /v2/health`
- shared `meta` response envelopes for the contract route
- contract-shaped validation and error envelopes
- deterministic retrieval-mode policy
- Utility LLM Host WebSocket client for retrieval support
- PostgreSQL-backed local knowledge store with JSON fallback when no database URL is configured
- live Exa search-then-extract wiring
- cache persistence from successful live extraction
- evidence chunk ranking, deduplication, and lightweight synthesis
- PM2-ready `ecosystem.config.cjs`

## Current Retrieval Strategy

Phase one uses deterministic retrieval policy plus optional Utility LLM Host support.

- `low` freshness prefers local cache when there are local hits.
- `medium` freshness uses live web when local cache is empty and combines local/live when cache exists.
- `high` and `realtime` freshness prefer live web, with local cache as supporting evidence when available.
- Image URL inputs can be sent to the Utility LLM Host for retrieval-oriented observations.
- Image ID inputs are still reference-level until RAG has a shared media resolver.

The local knowledge store is PostgreSQL-backed when `RAG_DATABASE_URL` is configured. It uses PostgreSQL full-text search today and includes nullable `pgvector` embedding fields for the future embedding pipeline. It is intentionally separate from chatbot memory.

## Runtime Configuration

The source of truth for local runtime values is `service.config.cjs`.

Secrets may be supplied through `.env.local`, `.env`, or process environment. For now the only expected secret is:

```env
EXA_API_KEY=
UTILITY_LLM_ENABLED=true
UTILITY_LLM_HOST_URL=http://127.0.0.1:3000
UTILITY_LLM_TIMEOUT_MS=30000
UTILITY_LLM_RETRIES=1
```

The preferred local store is PostgreSQL:

```text
Database: swirlock_rag
Role: swirlock_rag
Tablespace: D:\swirlock\postgresql\tablespaces\rag_knowledge
```

If `RAG_DATABASE_URL` is omitted, the service falls back to `data/knowledge-store.json`. `data/` is ignored because it is runtime state.

## Next Sensible Work

- Add embedding generation and vector retrieval once the Embedding Service contract exists.
- Add OpenAPI-generated DTO parity or schema validation if the contracts stabilize.
- Broaden e2e coverage for `POST /v2/retrieval/evidence`.
- Add a small seed/import command for local knowledge documents.
