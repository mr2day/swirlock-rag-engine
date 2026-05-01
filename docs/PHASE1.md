# Phase 1 Notes

## Development State

The RAG Engine now has a contract-facing `v2` retrieval endpoint plus the older diagnostic Exa UI.

Implemented:

- `POST /v2/retrieval/evidence`
- `GET /v2/health`
- shared `meta` response envelopes for the contract route
- contract-shaped validation and error envelopes
- deterministic retrieval-mode policy
- file-backed local knowledge store
- live Exa search-then-extract wiring
- cache persistence from successful live extraction
- evidence chunk ranking, deduplication, and lightweight synthesis
- PM2-ready `ecosystem.config.cjs`

## Current Retrieval Strategy

Phase one uses deterministic policy rather than a Utility LLM Host.

- `low` freshness prefers local cache when there are local hits.
- `medium` freshness uses live web when local cache is empty and combines local/live when cache exists.
- `high` and `realtime` freshness prefer live web, with local cache as supporting evidence when available.
- Image inputs are accepted as contract references, but visual interpretation is only reference-level until a Utility LLM Host is configured.

The local knowledge store is lexical, not vector-backed yet. It is still useful as a durable web-derived cache and is intentionally separate from chatbot memory.

## Runtime Configuration

The source of truth for local runtime values is `service.config.cjs`.

Secrets may be supplied through `.env.local`, `.env`, or process environment. For now the only expected secret is:

```env
EXA_API_KEY=
```

The local store defaults to:

```text
data/knowledge-store.json
```

`data/` is ignored because it is runtime state.

## Next Sensible Work

- Add a Utility LLM Host client for query interpretation and image observations.
- Replace lexical local retrieval with embedding-backed retrieval once the Embedding Service contract exists.
- Add OpenAPI-generated DTO parity or schema validation if the contracts stabilize.
- Broaden e2e coverage for `POST /v2/retrieval/evidence`.
- Add a small seed/import command for local knowledge documents.
