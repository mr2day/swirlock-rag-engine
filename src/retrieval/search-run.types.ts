import type { RequestContext, RetrievalFreshness } from './retrieval.types';

export interface SearchRunRequest {
  requestContext: RequestContext;
  query: {
    queryText: string;
    extractLimit?: number;
    freshness?: RetrievalFreshness;
  };
}

export interface ValidatedSearchRunRequest {
  requestContext: RequestContext;
  query: {
    queryText: string;
    extractLimit: number;
    freshness: RetrievalFreshness;
  };
}

export interface SearchRunResult {
  url: string;
  title: string;
  highlight: string;
  publishedAt: string | null;
  relevanceScore: number | null;
}

export interface SearchRunDiagnostics {
  extractLimit: number;
  resultCount: number;
  durationMs: number;
  providerRequestId: string | null;
}

export interface SearchRunResponseData {
  queryText: string;
  results: SearchRunResult[];
  diagnostics: SearchRunDiagnostics;
}
