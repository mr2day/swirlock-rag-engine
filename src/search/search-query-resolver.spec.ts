import { resolveSearchQuery } from './search-query-resolver';

describe('resolveSearchQuery', () => {
  it('rewrites location-sensitive weather queries to a canonical Bucharest query', () => {
    const result = resolveSearchQuery('what temperature is outside now?');

    expect(result.effectiveQuery).toBe(
      'current weather and temperature right now in Bucharest, Romania',
    );
    expect(result.appliedLocationFallback).toBe('Bucharest, Romania');
    expect(result.executionHints.intent).toBe('current-weather');
    expect(result.executionHints.tavilyCountry).toBe('romania');
    expect(result.executionHints.exaUserLocation).toBe('RO');
    expect(result.executionHints.excludeDomains).toEqual([
      'climate-data.org',
      'predictwind.com',
    ]);
    expect(result.executionHints.forceFreshContent).toBe(true);
  });

  it('does not rewrite non-location-sensitive queries', () => {
    const result = resolveSearchQuery('latest RAG evaluation methods');

    expect(result.effectiveQuery).toBe('latest RAG evaluation methods');
    expect(result.appliedLocationFallback).toBeNull();
    expect(result.executionHints.intent).toBe('general');
    expect(result.executionHints.excludeDomains).toEqual([]);
    expect(result.executionHints.forceFreshContent).toBe(false);
  });
});
