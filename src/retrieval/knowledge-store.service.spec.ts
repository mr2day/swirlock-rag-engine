import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { KnowledgeStoreService } from './knowledge-store.service';
import type { KnowledgeStoreSearchResult } from './knowledge-store.service';
import type { ExtractedDocument } from '../search/search.types';

describe('KnowledgeStoreService', () => {
  async function makeService() {
    const dir = await fs.mkdtemp(join(tmpdir(), 'swirlock-rag-store-'));
    const storePath = join(dir, 'knowledge-store.json');
    const configService = {
      get: jest.fn((key: string) =>
        key === 'RAG_KNOWLEDGE_STORE_PATH' ? storePath : undefined,
      ),
    } as unknown as ConfigService;

    return {
      service: new KnowledgeStoreService(configService),
      storePath,
    };
  }

  function makeSearchResult(input: {
    title: string;
    url: string;
    relevanceScore: number;
    freshnessScore?: number;
    score?: number;
  }): KnowledgeStoreSearchResult {
    const retrievedAt = '2026-05-08T00:00:00.000Z';
    return {
      document: {
        evidenceId: input.url,
        sourceTitle: input.title,
        sourceUrl: input.url,
        sourceDomain: new URL(input.url).hostname,
        content: input.title,
        excerpt: input.title,
        providerSummary: null,
        intent: 'test',
        searchQueries: [],
        publishedAt: null,
        firstRetrievedAt: retrievedAt,
        lastRetrievedAt: retrievedAt,
        lastSeenAt: retrievedAt,
        timesSeen: 1,
        contentHash: input.url,
      },
      relevanceScore: input.relevanceScore,
      freshnessScore: input.freshnessScore ?? 0.9,
      score: input.score ?? input.relevanceScore,
    };
  }

  it('persists extracted documents and finds them through lexical search', async () => {
    const { service, storePath } = await makeService();
    const document: ExtractedDocument = {
      title: 'Vector indexes for retrieval augmented generation',
      url: 'https://example.com/rag-vector-indexes',
      publishedAt: '2026-04-30T10:00:00.000Z',
      score: 0.8,
      content:
        'Hybrid retrieval systems combine lexical search and vector indexes for better grounded answers.',
      contentLength: 92,
      excerpt:
        'Hybrid retrieval systems combine lexical search and vector indexes.',
      providerSummary: null,
      structuredSummary: null,
      weatherSnapshot: null,
    };

    await service.upsertExtractedDocuments(
      [document],
      'hybrid vector retrieval',
      'general',
      '2026-05-01T12:00:00.000Z',
    );

    const results = await service.search('vector retrieval', 'medium', 3);
    const rawStore = await fs.readFile(storePath, 'utf8');

    expect(results).toHaveLength(1);
    expect(results[0]?.document.sourceTitle).toContain('Vector indexes');
    expect(rawStore).toContain('rag-vector-indexes');
  });

  it('does not return unrelated documents only because they are fresh', async () => {
    const { service } = await makeService();
    const document: ExtractedDocument = {
      title: 'Sourdough starter troubleshooting',
      url: 'https://example.com/sourdough',
      publishedAt: '2026-05-01T10:00:00.000Z',
      score: 0.9,
      content:
        'A fresh guide about bread flour, starter feeding schedules, and oven spring.',
      contentLength: 78,
      excerpt: 'A fresh guide about bread flour and starter feeding schedules.',
      providerSummary: null,
      structuredSummary: null,
      weatherSnapshot: null,
    };

    await service.upsertExtractedDocuments(
      [document],
      'bread starter',
      'general',
      '2026-05-01T12:00:00.000Z',
    );

    await expect(service.search('vector retrieval', 'low', 3)).resolves.toEqual(
      [],
    );
  });

  it('drops weak vector-only hits during hybrid search', async () => {
    const { service } = await makeService();
    jest.spyOn(service, 'search').mockResolvedValue([
      makeSearchResult({
        title: 'Aspasia - Livius',
        url: 'https://livius.org/articles/person/aspasia/',
        relevanceScore: 0.18,
        score: 0.56,
      }),
    ]);
    jest.spyOn(service, 'searchByEmbedding').mockResolvedValue([
      makeSearchResult({
        title: 'New York City, NY Hourly Weather Forecast',
        url: 'https://www.wunderground.com/hourly/us/ny/new-york-city',
        relevanceScore: 0.42,
        freshnessScore: 0.99,
        score: 0.72,
      }),
    ]);

    const results = await service.searchHybrid(
      'Aspasia of Miletus wife of Pericles historical facts',
      [0.1, 0.2, 0.3],
      'medium',
      10,
    );

    expect(results.map((result) => result.document.sourceTitle)).toEqual([
      'Aspasia - Livius',
    ]);
  });

  it('drops weak lexical-only hits during hybrid search', async () => {
    const { service } = await makeService();
    jest.spyOn(service, 'search').mockResolvedValue([
      makeSearchResult({
        title: 'Finding all children for multiple parents in single SQL query',
        url: 'https://stackoverflow.com/questions/8204770/finding-all-children-for-multiple-parents-in-single-sql-query',
        relevanceScore: 0.1,
        score: 0.56,
      }),
    ]);
    jest.spyOn(service, 'searchByEmbedding').mockResolvedValue([]);

    const results = await service.searchHybrid(
      'Aspasia of Miletus wife of Pericles historical facts',
      [0.1, 0.2, 0.3],
      'medium',
      10,
    );

    expect(results).toEqual([]);
  });

  it('upserts by source URL instead of duplicating repeated live results', async () => {
    const { service } = await makeService();
    const document: ExtractedDocument = {
      title: 'Current market quote',
      url: 'https://example.com/quote',
      publishedAt: null,
      score: 0.8,
      content: 'A current quote page with price, change, volume, and range.',
      contentLength: 60,
      excerpt: 'A current quote page with price and range.',
      providerSummary: null,
      structuredSummary: null,
      weatherSnapshot: null,
    };

    await service.upsertExtractedDocuments(
      [document],
      'stock quote',
      'market-price',
      '2026-05-01T12:00:00.000Z',
    );
    await service.upsertExtractedDocuments(
      [document],
      'latest stock quote',
      'market-price',
      '2026-05-01T12:05:00.000Z',
    );

    expect(await service.count()).toBe(1);
  });
});
