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

## Current Status

This repository is still at an early implementation stage.

At the moment, it contains:

- a NestJS service scaffold
- the initial package setup for future retrieval integrations

The production retrieval pipeline is not fully implemented yet.
