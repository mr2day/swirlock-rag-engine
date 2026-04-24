export const SEARCH_PROVIDERS = ['exa'] as const;

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
  effectiveQuery: string;
  appliedLocationFallback: string | null;
  notes: string[];
  latencyMs: number;
  normalized: NormalizedSearchResult[];
  raw: unknown;
}

export interface ProviderStageMetadata {
  requestId: string | null;
  providerReportedLatencyMs: number | null;
  usageCredits: number | null;
  costDollarsTotal: number | null;
}

export interface SearchStageResult extends ProviderStageMetadata {
  latencyMs: number;
  resultCount: number;
  topResults: NormalizedSearchResult[];
  resolvedSearchType: string | null;
}

export type StructuredSummaryType = 'weather' | 'market-price' | 'sports-score';

export interface StructuredSummaryField {
  label: string;
  value: string;
}

export interface StructuredSummary {
  type: StructuredSummaryType;
  heading: string | null;
  fields: StructuredSummaryField[];
}

export interface WeatherSnapshot {
  location: string | null;
  observationTime: string | null;
  condition: string | null;
  temperature: string | null;
  feelsLike: string | null;
  humidity: string | null;
  wind: string | null;
  high: string | null;
  low: string | null;
}

export interface ExtractedDocument {
  title: string;
  url: string;
  publishedAt: string | null;
  score: number | null;
  content: string;
  contentLength: number;
  excerpt: string;
  providerSummary: string | null;
  structuredSummary: StructuredSummary | null;
  weatherSnapshot: WeatherSnapshot | null;
}

export interface ExtractStageResult extends ProviderStageMetadata {
  latencyMs: number;
  documentCount: number;
  totalCharacters: number;
  failedSources: Array<{
    url: string;
    error: string;
  }>;
  documents: ExtractedDocument[];
}

export interface ProviderComparisonResult {
  provider: SearchProvider;
  status: 'ok' | 'error';
  totalLatencyMs: number;
  error: string | null;
  search: SearchStageResult | null;
  extract: ExtractStageResult | null;
}

export interface SearchExtractComparisonResult {
  query: string;
  effectiveQuery: string;
  appliedLocationFallback: string | null;
  notes: string[];
  searchLimit: number;
  extractLimit: number;
  totalLatencyMs: number;
  completedAt: string;
  providers: ProviderComparisonResult[];
}
