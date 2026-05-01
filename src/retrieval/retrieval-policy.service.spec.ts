import { RetrievalPolicyService } from './retrieval-policy.service';

describe('RetrievalPolicyService', () => {
  const service = new RetrievalPolicyService();

  it('uses local cache for low-freshness queries when local coverage exists', () => {
    const decision = service.decide({
      allowedModes: ['local_rag', 'live_web'],
      freshness: 'low',
      localResultCount: 2,
      hasSearchableText: true,
      hasImageInput: false,
    });

    expect(decision.mode).toBe('local_rag');
    expect(decision.useLocal).toBe(true);
    expect(decision.useLive).toBe(false);
  });

  it('combines local and live retrieval for high-freshness queries with cache support', () => {
    const decision = service.decide({
      allowedModes: ['local_rag', 'live_web'],
      freshness: 'high',
      localResultCount: 1,
      hasSearchableText: true,
      hasImageInput: false,
    });

    expect(decision.mode).toBe('local_and_live');
    expect(decision.useLocal).toBe(true);
    expect(decision.useLive).toBe(true);
  });

  it('uses live web when the local cache has no useful hits', () => {
    const decision = service.decide({
      allowedModes: ['local_rag', 'live_web'],
      freshness: 'medium',
      localResultCount: 0,
      hasSearchableText: true,
      hasImageInput: false,
    });

    expect(decision.mode).toBe('live_web');
    expect(decision.useLocal).toBe(false);
    expect(decision.useLive).toBe(true);
  });

  it('does not perform live search for image-only requests without image observations', () => {
    const decision = service.decide({
      allowedModes: ['local_rag', 'live_web'],
      freshness: 'high',
      localResultCount: 0,
      hasSearchableText: false,
      hasImageInput: true,
    });

    expect(decision.mode).toBe('none');
    expect(decision.useLocal).toBe(false);
    expect(decision.useLive).toBe(false);
  });
});
