import { resolveSearchQuery } from './search-query-resolver';

describe('resolveSearchQuery', () => {
  it('rewrites location-sensitive weather queries to a canonical Bucharest query', () => {
    const result = resolveSearchQuery('what temperature is outside now?');

    expect(result.effectiveQuery).toBe(
      'current weather and temperature right now in Bucharest, Romania',
    );
    expect(result.appliedLocationFallback).toBe('Bucharest, Romania');
    expect(result.executionHints.intent).toBe('current-weather');
    expect(result.executionHints.exaUserLocation).toBe('RO');
    expect(result.executionHints.exaCategory).toBeNull();
    expect(result.executionHints.excludeDomains).toEqual([
      'climate-data.org',
      'predictwind.com',
    ]);
    expect(result.executionHints.forceFreshContent).toBe(true);
  });

  it('rewrites live market-price queries to a canonical quote query', () => {
    const result = resolveSearchQuery('AAPL stock price');

    expect(result.effectiveQuery).toBe(
      'current live market price and latest quote: AAPL stock price',
    );
    expect(result.appliedLocationFallback).toBeNull();
    expect(result.executionHints.intent).toBe('market-price');
    expect(result.executionHints.exaCategory).toBeNull();
    expect(result.executionHints.forceFreshContent).toBe(true);
  });

  it('rewrites sports-score queries to a canonical live-score query', () => {
    const result = resolveSearchQuery('score of real madrid vs barcelona');

    expect(result.effectiveQuery).toBe(
      'live score today, or if there is no live game the most recent result: score of real madrid vs barcelona',
    );
    expect(result.appliedLocationFallback).toBeNull();
    expect(result.executionHints.intent).toBe('sports-score');
    expect(result.executionHints.exaCategory).toBe('news');
    expect(result.executionHints.forceFreshContent).toBe(true);
  });

  it('does not rewrite non-location-sensitive queries', () => {
    const result = resolveSearchQuery('latest RAG evaluation methods');

    expect(result.effectiveQuery).toBe('latest RAG evaluation methods');
    expect(result.appliedLocationFallback).toBeNull();
    expect(result.executionHints.intent).toBe('general');
    expect(result.executionHints.exaCategory).toBeNull();
    expect(result.executionHints.excludeDomains).toEqual([]);
    expect(result.executionHints.forceFreshContent).toBe(false);
  });
});
