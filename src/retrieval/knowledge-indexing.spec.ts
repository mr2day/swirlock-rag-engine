import {
  canonicalizeUrl,
  chunkKnowledgeContent,
  computeRefreshPolicy,
  createStableDocumentId,
  getSourceDomain,
  scoreSourceQuality,
  selectDiverseResults,
} from './knowledge-indexing';

describe('knowledge indexing helpers', () => {
  it('canonicalizes URLs for deduplication', () => {
    expect(
      canonicalizeUrl(
        'HTTPS://www.Example.com/path/?utm_source=test&b=2&a=1#section',
      ),
    ).toBe('https://example.com/path?a=1&b=2');
    expect(getSourceDomain('https://www.Example.com/path')).toBe('example.com');
  });

  it('creates stable chunk IDs from stable document IDs and content', () => {
    const documentId = createStableDocumentId({
      canonicalUrl: 'https://example.com/rag',
      contentHash: 'hash',
      title: 'RAG',
    });
    const content = Array.from(
      { length: 40 },
      (_, index) =>
        `Sentence ${index} about retrieval augmented generation and grounded evidence.`,
    ).join(' ');
    const first = chunkKnowledgeContent({ documentId, content });
    const second = chunkKnowledgeContent({ documentId, content });

    expect(first.length).toBeGreaterThan(1);
    expect(first.map((chunk) => chunk.id)).toEqual(
      second.map((chunk) => chunk.id),
    );
    expect(first[0]?.content).toContain('retrieval augmented generation');
  });

  it('scores official sources above generic community sources', () => {
    expect(
      scoreSourceQuality({
        sourceUrl: 'https://docs.example.gov/retrieval',
        sourceTitle: 'Official retrieval documentation',
      }),
    ).toBeGreaterThan(
      scoreSourceQuality({
        sourceUrl: 'https://reddit.com/r/rag/comments/1',
        sourceTitle: 'RAG discussion',
      }),
    );
  });

  it('computes shorter refresh windows for high-volatility domains', () => {
    const policy = computeRefreshPolicy({
      publishedAt: '2026-05-01T00:00:00.000Z',
      retrievedAt: '2026-05-02T00:00:00.000Z',
      freshnessIntent: 'low',
      sourceUrl: 'https://market.example.com/quote',
    });

    expect(policy.refreshReason).toBe('volatile source domain');
    expect(policy.refreshAfter).toBe('2026-05-05T00:00:00.000Z');
  });

  it('penalizes repeated domains during diversity selection', () => {
    const results = [
      { domain: 'a.example', score: 1 },
      { domain: 'a.example', score: 0.98 },
      { domain: 'b.example', score: 0.9 },
    ];

    expect(
      selectDiverseResults(
        results,
        2,
        (result) => result.domain,
        (result) => result.score,
      ),
    ).toEqual([results[0], results[2]]);
  });
});
