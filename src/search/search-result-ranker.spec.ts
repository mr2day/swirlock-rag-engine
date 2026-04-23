import { rankSearchResults } from './search-result-ranker';
import type { SearchExecutionHints } from './search-query-resolver';
import type { NormalizedSearchResult } from './search.types';

describe('rankSearchResults', () => {
  it('pushes current-weather pages above monthly and historical pages', () => {
    const executionHints: SearchExecutionHints = {
      intent: 'current-weather',
      exaUserLocation: 'RO',
      tavilyCountry: 'romania',
      excludeDomains: ['climate-data.org', 'predictwind.com'],
      forceFreshContent: true,
    };

    const results: NormalizedSearchResult[] = [
      {
        title: 'Weather Bucharest in April 2026: Temperature & Climate',
        url: 'https://climate-data.org/bucharest/april',
        snippet: 'Temperature April max. 17.7°C',
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
});
