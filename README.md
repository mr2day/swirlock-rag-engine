# Swirlock RAG Engine

Multimodal retrieval engine that supplies structured evidence to AI systems.

## Purpose

Swirlock RAG Engine retrieves relevant information from internal and external sources and returns structured evidence that can be used by AI models.

Its role is to provide:
- accurate data
- up-to-date information
- grounded external knowledge

## Input

The engine accepts multimodal input:

- text
- images
- combined input

Images are interpreted and converted into textual observations used for retrieval.

## Retrieval Modes

Each input is classified into one of:

- none
- local_rag
- live_web
- local_and_live

## Processing

For each input, the engine:

1. interprets the input
2. normalizes the query
3. decides if retrieval is required
4. retrieves relevant data (local and/or web)
5. ranks and filters results

## Output

The engine returns structured evidence:

- relevant content
- source metadata
- relevance scores
- optional freshness information

This output is intended to be consumed by downstream AI systems.