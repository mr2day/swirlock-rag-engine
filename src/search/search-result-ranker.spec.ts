import { rankSearchResults } from './search-result-ranker';
import type { SearchExecutionHints } from './search-query-resolver';
import type { NormalizedSearchResult } from './search.types';

describe('rankSearchResults', () => {
  it('pushes current-weather pages above monthly and historical pages', () => {
    const executionHints: SearchExecutionHints = {
      intent: 'current-weather',
      exaUserLocation: 'RO',
      exaCategory: null,
      excludeDomains: ['climate-data.org', 'predictwind.com'],
      forceFreshContent: true,
    };

    const results: NormalizedSearchResult[] = [
      {
        title: 'Weather Bucharest in April 2026: Temperature & Climate',
        url: 'https://climate-data.org/bucharest/april',
        snippet: 'Temperature April max. 17.7\u00b0C',
        score: 0.9,
        publishedAt: null,
      },
      {
        title: 'Bucharest, Romania Weather Conditions | Weather Underground',
        url: 'https://www.wunderground.com/weather/ro/bucharest',
        snippet: 'Current weather conditions, humidity, wind, and feels like.',
        score: 0.3,
        publishedAt: null,
      },
    ];

    const ranked = rankSearchResults(results, executionHints);

    expect(ranked[0]?.title).toContain('Weather Conditions');
    expect(ranked[1]?.title).toContain('Climate');
  });

  it('pushes live quote pages above history and prediction pages', () => {
    const executionHints: SearchExecutionHints = {
      intent: 'market-price',
      exaUserLocation: null,
      exaCategory: null,
      excludeDomains: [],
      forceFreshContent: true,
    };

    const results: NormalizedSearchResult[] = [
      {
        title: 'Tesla stock price prediction for 2027',
        url: 'https://example.com/tsla-prediction',
        snippet: 'Long-term analysis and price target.',
        score: 0.9,
        publishedAt: null,
      },
      {
        title: 'Tesla Inc. stock quote',
        url: 'https://finance.yahoo.com/quote/TSLA',
        snippet: 'Current price, after hours move, and market cap.',
        score: 0.3,
        publishedAt: null,
      },
    ];

    const ranked = rankSearchResults(results, executionHints);

    expect(ranked[0]?.title).toContain('stock quote');
    expect(ranked[1]?.title).toContain('prediction');
  });

  it('pushes live score pages above standings and schedule pages', () => {
    const executionHints: SearchExecutionHints = {
      intent: 'sports-score',
      exaUserLocation: null,
      exaCategory: 'news',
      excludeDomains: [],
      forceFreshContent: true,
    };

    const results: NormalizedSearchResult[] = [
      {
        title: 'Premier League standings',
        url: 'https://example.com/standings',
        snippet: 'Updated table and fixtures.',
        score: 0.8,
        publishedAt: null,
      },
      {
        title: 'Arsenal vs Chelsea live score',
        url: 'https://www.flashscore.com/match/arsenal-chelsea',
        snippet: 'Final score and match result.',
        score: 0.2,
        publishedAt: null,
      },
    ];

    const ranked = rankSearchResults(results, executionHints);

    expect(ranked[0]?.title).toContain('live score');
    expect(ranked[1]?.title).toContain('standings');
  });

  it('prefers the more recent sports result when both look relevant', () => {
    const executionHints: SearchExecutionHints = {
      intent: 'sports-score',
      exaUserLocation: null,
      exaCategory: 'news',
      excludeDomains: [],
      forceFreshContent: true,
    };

    const results: NormalizedSearchResult[] = [
      {
        title: 'Real Madrid 3-2 Barcelona (Apr 21, 2024) Final Score',
        url: 'https://example.com/2024-final-score',
        snippet: 'Final score from an older match.',
        score: 0.4,
        publishedAt: '2024-04-21T00:00:00.000Z',
      },
      {
        title: 'Real Madrid 0-3 Barcelona (Mar 29, 2026) Final Score',
        url: 'https://example.com/2026-final-score',
        snippet: 'Final score from the latest match.',
        score: 0.4,
        publishedAt: '2026-03-29T00:00:00.000Z',
      },
    ];

    const ranked = rankSearchResults(results, executionHints);

    expect(ranked[0]?.title).toContain('2026');
    expect(ranked[1]?.title).toContain('2024');
  });
});
