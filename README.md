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
- Main LLM Server
- Embedding Service

The RAG Engine owns retrieval semantics.
It does not own memory semantics, context-window management, or final answer generation.

## What This Service Does

The RAG Engine:

- accepts text, image, or multimodal retrieval input
- uses a utility LLM to interpret the request, including image understanding when needed
- normalizes the retrieval query
- chooses a retrieval mode using utility-LLM guidance plus deterministic rules
- searches a local knowledge store, the live web, or both
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

Images are interpreted by the utility LLM and converted into semantic observations that support retrieval.

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

The app uses `service.config.cjs` as the committed source of truth for local runtime settings such as host, port, retrieval limits, and the local knowledge-store path.

Secrets may still come from `.env.local`, `.env`, or process environment. For local testing, create a `.env` file based on `.env.example`:


```env
EXA_API_KEY=your_exa_key
```

The default local knowledge store is:

```text
data/knowledge-store.json
```

`data/` is ignored by git because it is runtime retrieval state.

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

For local process management:

```powershell
npm run build
pm2 start ecosystem.config.cjs
```

## Diagnostic UI

The diagnostic search UI is available at:

- `http://127.0.0.1:3000/dev/search/ui`

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
- a file-backed local web-derived knowledge store
- deterministic retrieval-mode routing
- evidence packaging and lightweight retrieval synthesis
- unit coverage for query resolution, ranking, cache persistence, retrieval policy, and contract retrieval behavior

The remaining larger pieces are Utility LLM Host integration, image interpretation, embedding-backed local retrieval, and broader e2e contract coverage.
