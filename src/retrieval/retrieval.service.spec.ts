import type { ConfigService } from '@nestjs/config';
import type { SearchService } from '../search/search.service';
import type { ExtractedDocument } from '../search/search.types';
import type { KnowledgeStoreService } from './knowledge-store.service';
import { RetrievalPolicyService } from './retrieval-policy.service';
import { RetrievalService } from './retrieval.service';
import type { RetrieveEvidenceRequest } from './retrieval.types';

describe('RetrievalService', () => {
  function makeRequest(
    overrides: Partial<RetrieveEvidenceRequest['query']> = {},
  ): RetrieveEvidenceRequest {
    return {
      requestContext: {
        callerService: 'chat-orchestrator',
        priority: 'interactive',
        requestedAt: '2026-05-01T12:00:00Z',
      },
      query: {
        parts: [{ type: 'text', text: 'latest RAG evaluation methods' }],
        freshness: 'low',
        allowedModes: ['local_rag', 'live_web'],
        maxEvidenceChunks: 4,
        synthesisMode: 'brief',
        ...overrides,
      },
    };
  }

  function makeHarness() {
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          RAG_MAX_EVIDENCE_CHUNKS: '8',
          RAG_LIVE_SEARCH_LIMIT: '5',
          RAG_LIVE_EXTRACT_LIMIT: '3',
        };

        return values[key];
      }),
    } as unknown as ConfigService;
    const searchThenExtract = jest.fn();
    const knowledgeSearch = jest.fn();
    const upsertExtractedDocuments = jest.fn();
    const count = jest.fn();
    const searchService = {
      searchThenExtract,
    } as unknown as jest.Mocked<SearchService>;
    const knowledgeStore = {
      storePath: 'C:/tmp/knowledge-store.json',
      search: knowledgeSearch,
      upsertExtractedDocuments,
      count,
    } as unknown as jest.Mocked<KnowledgeStoreService>;
    const service = new RetrievalService(
      configService,
      searchService,
      knowledgeStore,
      new RetrievalPolicyService(),
    );

    return {
      service,
      searchThenExtract,
      knowledgeSearch,
      upsertExtractedDocuments,
    };
  }

  it('returns local-cache evidence without live search when caller restricts to local retrieval', async () => {
    const { service, searchThenExtract, knowledgeSearch } = makeHarness();

    knowledgeSearch.mockResolvedValue([
      {
        document: {
          evidenceId: '0196f9e8-71b6-7dc0-8d2c-b0b3c4567890',
          sourceTitle: 'RAG evaluation guide',
          sourceUrl: 'https://example.com/rag-eval',
          excerpt:
            'RAG evaluation uses groundedness, faithfulness, and recall.',
          content:
            'RAG evaluation uses groundedness, faithfulness, and recall.',
          providerSummary: null,
          intent: 'general',
          searchQueries: ['latest RAG evaluation methods'],
          publishedAt: '2026-04-20T00:00:00.000Z',
          firstRetrievedAt: '2026-04-21T00:00:00.000Z',
          lastRetrievedAt: '2026-04-21T00:00:00.000Z',
          lastSeenAt: '2026-04-21T00:00:00.000Z',
          timesSeen: 1,
          contentHash: 'hash',
        },
        relevanceScore: 0.82,
        freshnessScore: 0.7,
        score: 42,
      },
    ]);

    const result = await service.retrieveEvidence(
      makeRequest({ allowedModes: ['local_rag'] }),
      'turn-1',
    );

    expect(searchThenExtract).not.toHaveBeenCalled();
    expect(result.normalizedQuery.retrievalMode).toBe('local_rag');
    expect(result.evidenceChunks[0]?.sourceType).toBe('local_cache');
    expect(result.retrievalDiagnostics.localSearchPerformed).toBe(true);
  });

  it('runs live retrieval on cache miss and persists extracted documents', async () => {
    const {
      service,
      searchThenExtract,
      knowledgeSearch,
      upsertExtractedDocuments,
    } = makeHarness();
    const document: ExtractedDocument = {
      title: 'RAG evaluation benchmark update',
      url: 'https://example.com/rag-benchmark',
      publishedAt: '2026-05-01T10:00:00.000Z',
      score: 0.9,
      content: 'A benchmark update discusses groundedness and answer recall.',
      contentLength: 64,
      excerpt: 'A benchmark update discusses groundedness and answer recall.',
      providerSummary: null,
      structuredSummary: null,
      weatherSnapshot: null,
    };

    knowledgeSearch.mockResolvedValue([]);
    upsertExtractedDocuments.mockResolvedValue([]);
    searchThenExtract.mockResolvedValue({
      query: 'latest RAG evaluation methods',
      effectiveQuery: 'latest RAG evaluation methods',
      appliedLocationFallback: null,
      notes: [],
      searchLimit: 5,
      extractLimit: 3,
      totalLatencyMs: 12,
      completedAt: '2026-05-01T12:00:00.000Z',
      status: 'ok',
      error: null,
      search: {
        latencyMs: 5,
        requestId: 'exa-request',
        providerReportedLatencyMs: null,
        usageCredits: null,
        costDollarsTotal: null,
        resultCount: 1,
        topResults: [],
        resolvedSearchType: null,
      },
      extract: {
        latencyMs: 7,
        requestId: 'exa-extract',
        providerReportedLatencyMs: null,
        usageCredits: null,
        costDollarsTotal: null,
        documentCount: 1,
        totalCharacters: 64,
        failedSources: [],
        documents: [document],
      },
    });

    const result = await service.retrieveEvidence(makeRequest(), 'turn-1');

    expect(searchThenExtract).toHaveBeenCalledWith(
      'latest RAG evaluation methods',
      5,
      3,
    );
    expect(upsertExtractedDocuments).toHaveBeenCalledWith(
      [document],
      'latest RAG evaluation methods',
      'general',
      expect.any(String),
    );
    expect(result.normalizedQuery.retrievalMode).toBe('live_web');
    expect(result.evidenceChunks[0]?.sourceType).toBe('web');
  });

  it('returns live evidence when cache persistence fails', async () => {
    const {
      service,
      searchThenExtract,
      knowledgeSearch,
      upsertExtractedDocuments,
    } = makeHarness();
    const document: ExtractedDocument = {
      title: 'RAG evaluation benchmark update',
      url: 'https://example.com/rag-benchmark',
      publishedAt: '2026-05-01T10:00:00.000Z',
      score: 0.9,
      content: 'A benchmark update discusses groundedness and answer recall.',
      contentLength: 64,
      excerpt: 'A benchmark update discusses groundedness and answer recall.',
      providerSummary: null,
      structuredSummary: null,
      weatherSnapshot: null,
    };

    knowledgeSearch.mockResolvedValue([]);
    upsertExtractedDocuments.mockRejectedValue(new Error('disk is full'));
    searchThenExtract.mockResolvedValue({
      query: 'latest RAG evaluation methods',
      effectiveQuery: 'latest RAG evaluation methods',
      appliedLocationFallback: null,
      notes: [],
      searchLimit: 5,
      extractLimit: 3,
      totalLatencyMs: 12,
      completedAt: '2026-05-01T12:00:00.000Z',
      status: 'ok',
      error: null,
      search: null,
      extract: {
        latencyMs: 7,
        requestId: 'exa-extract',
        providerReportedLatencyMs: null,
        usageCredits: null,
        costDollarsTotal: null,
        documentCount: 1,
        totalCharacters: 64,
        failedSources: [],
        documents: [document],
      },
    });

    const result = await service.retrieveEvidence(makeRequest(), 'turn-1');

    expect(result.evidenceChunks).toHaveLength(1);
    expect(result.evidenceChunks[0]?.sourceType).toBe('web');
    expect(result.retrievalDiagnostics.warnings?.[0]).toContain(
      'cache persistence failed',
    );
  });

  it('treats an explicit empty allowedModes array as no retrieval allowed', async () => {
    const { service, searchThenExtract, knowledgeSearch } = makeHarness();

    const result = await service.retrieveEvidence(
      makeRequest({ allowedModes: [] }),
      'turn-1',
    );

    expect(knowledgeSearch).not.toHaveBeenCalled();
    expect(searchThenExtract).not.toHaveBeenCalled();
    expect(result.normalizedQuery.retrievalMode).toBe('none');
    expect(result.evidenceChunks).toEqual([]);
  });

  it('keeps a successful envelope shape when live retrieval is unavailable', async () => {
    const { service, searchThenExtract, knowledgeSearch } = makeHarness();

    knowledgeSearch.mockResolvedValue([]);
    searchThenExtract.mockResolvedValue({
      query: 'latest RAG evaluation methods',
      effectiveQuery: 'latest RAG evaluation methods',
      appliedLocationFallback: null,
      notes: [],
      searchLimit: 5,
      extractLimit: 3,
      totalLatencyMs: 2,
      completedAt: '2026-05-01T12:00:00.000Z',
      status: 'error',
      error: 'EXA_API_KEY is not configured.',
      search: null,
      extract: null,
    });

    const result = await service.retrieveEvidence(makeRequest(), 'turn-1');

    expect(result.evidenceChunks).toEqual([]);
    expect(result.evidenceSynthesis?.confidence).toBe('low');
    expect(result.retrievalDiagnostics.liveSearchError).toContain(
      'EXA_API_KEY',
    );
  });
});
