import type { ConfigService } from '@nestjs/config';
import { ContentExcerptService } from './content-excerpt.service';
import { WikipediaSearchService } from './wikipedia-search.service';

const ORIGINAL_FETCH = global.fetch;

function makeConfigService(
  overrides: Record<string, string> = {},
): ConfigService {
  const values: Record<string, string> = {
    WIKIPEDIA_SEARCH_ENABLED: 'true',
    WIKIPEDIA_BASE_URL: 'https://en.wikipedia.org',
    WIKIPEDIA_USER_AGENT: 'swirlock-rag-engine-test',
    WIKIPEDIA_SEARCH_LIMIT: '5',
    WIKIPEDIA_EXTRACT_LIMIT: '3',
    WIKIPEDIA_TIMEOUT_MS: '5000',
    ...overrides,
  };
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asUrlString(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.toString();
  if (typeof input === 'string') return input;
  return input.url;
}

describe('WikipediaSearchService', () => {
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it('returns disabled-status inspection when WIKIPEDIA_SEARCH_ENABLED=false', async () => {
    const service = new WikipediaSearchService(
      makeConfigService({ WIKIPEDIA_SEARCH_ENABLED: 'false' }),
      new ContentExcerptService(),
    );
    const result = await service.searchThenExtract('Louis Malle', 5, 3);
    expect(result.status).toBe('ok');
    expect(result.search).toBeNull();
    expect(result.extract).toBeNull();
    expect(result.error).toBe('Wikipedia provider is disabled.');
  });

  it('searches via MediaWiki then extracts and emits progress events', async () => {
    const fetchMock = jest.fn((input: RequestInfo | URL) => {
      const url = new URL(asUrlString(input));
      if (url.searchParams.get('list') === 'search') {
        return Promise.resolve(
          jsonResponse({
            query: {
              search: [
                {
                  title: 'Louis Malle',
                  pageid: 12345,
                  snippet:
                    'Louis Malle was a <span class="searchmatch">French</span> film director.',
                  wordcount: 4200,
                  timestamp: '2026-04-01T00:00:00Z',
                },
                {
                  title: 'My Dinner with Andre',
                  pageid: 67890,
                  snippet: 'A 1981 film directed by Louis Malle.',
                  wordcount: 2300,
                  timestamp: '2026-03-15T00:00:00Z',
                },
              ],
            },
          }),
        );
      }
      if (
        url.searchParams.get('action') === 'query' &&
        url.searchParams.get('prop')?.startsWith('extracts')
      ) {
        return Promise.resolve(
          jsonResponse({
            query: {
              pages: [
                {
                  pageid: 12345,
                  title: 'Louis Malle',
                  extract:
                    'Louis Malle was a French film director, screenwriter, and producer.',
                  fullurl: 'https://en.wikipedia.org/wiki/Louis_Malle',
                },
                {
                  pageid: 67890,
                  title: 'My Dinner with Andre',
                  extract:
                    'My Dinner with Andre is a 1981 American comedy-drama film.',
                  fullurl: 'https://en.wikipedia.org/wiki/My_Dinner_with_Andre',
                },
              ],
            },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url.toString()}`));
    });
    global.fetch = fetchMock;

    const events: string[] = [];
    const service = new WikipediaSearchService(
      makeConfigService(),
      new ContentExcerptService(),
    );
    const result = await service.searchThenExtract(
      'Louis Malle',
      5,
      2,
      (event) => {
        events.push(event.type);
      },
    );

    expect(result.status).toBe('ok');
    expect(result.search?.resultCount).toBe(2);
    expect(result.search?.topResults[0]?.url).toBe(
      'https://en.wikipedia.org/wiki/Louis_Malle',
    );
    expect(result.search?.topResults[0]?.snippet).toContain(
      'Louis Malle was a French film director.',
    );
    expect(result.extract?.documentCount).toBe(2);
    expect(result.extract?.documents[0]?.url).toBe(
      'https://en.wikipedia.org/wiki/Louis_Malle',
    );
    expect(result.extract?.documents[0]?.content).toContain(
      'Louis Malle was a French film director',
    );
    expect(events).toEqual([
      'search_started',
      'search_completed',
      'extract_started',
      'extract_completed',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstFetch = fetchMock.mock.calls[0]?.[0];
    const firstUrl = new URL(asUrlString(firstFetch));
    expect(firstUrl.searchParams.get('srsearch')).toBe('Louis Malle');
    expect(firstUrl.searchParams.get('srlimit')).toBe('5');
  });

  it('returns an error inspection when the MediaWiki API fails', async () => {
    const fetchMock = jest.fn(() =>
      Promise.resolve(
        new Response('not found', {
          status: 404,
          statusText: 'Not Found',
        }),
      ),
    );
    global.fetch = fetchMock;

    const service = new WikipediaSearchService(
      makeConfigService(),
      new ContentExcerptService(),
    );
    const result = await service.searchThenExtract('whatever', 3, 1);
    expect(result.status).toBe('error');
    expect(result.error).toContain('HTTP 404');
    expect(result.search).toBeNull();
  });
});
