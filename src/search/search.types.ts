export const SEARCH_PROVIDERS = ['ddg', 'tavily', 'exa'] as const;

export type SearchProvider = (typeof SEARCH_PROVIDERS)[number];

export function isSearchProvider(value: string): value is SearchProvider {
  return SEARCH_PROVIDERS.includes(value as SearchProvider);
}

export interface NormalizedSearchResult {
  title: string;
  url: string;
  snippet: string;
  score: number | null;
  publishedAt: string | null;
}

export interface SearchExecutionResult {
  provider: SearchProvider;
  query: string;
  latencyMs: number;
  normalized: NormalizedSearchResult[];
  raw: unknown;
}
