import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { KnowledgeStoreService } from './knowledge-store.service';
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
