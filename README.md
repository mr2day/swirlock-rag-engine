# Swirlock RAG Engine

Retrieval service for the Swirlock ecosystem. The ecosystem API is
WebSocket-only in contracts v4.

## Endpoint

```text
WS /v4/retrieval
```

Client message types:

- `retrieve_evidence`
- `health.get`
- `cancel`
- `heartbeat`

Retrieval progress is emitted as v4 envelope messages whose `type` is the
retrieval event name, including:

- `retrieval.started`
- `utility_llm.retrieval_support.started`
- `utility_llm.retrieval_support.completed`
- `query.normalized`
- `embedding.query.started`
- `embedding.query.completed`
- `local.search.started`
- `local.search.completed`
- `live.search.started`
- `live.search.completed`
- `live.extract.started`
- `live.extract.completed`
- `evidence.chunk`
- `retrieval.completed`
- `retrieval.failed`

Each event payload contains `sequence`, `occurredAt`, and `data`.

There are no ecosystem REST endpoints.

## Upstream Connections

The RAG Engine keeps persistent WebSockets to:

- Utility Model Host: `/v4/model`
- Embedding Service: `/v4/embeddings`

## Run

```powershell
npm install
npm run build
npm run start:prod
```

Configuration lives in `service.config.cjs`.
