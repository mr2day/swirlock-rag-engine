import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  tavily,
  type TavilyClient,
  type TavilyExtractResponse,
  type TavilySearchResponse,
} from '@tavily/core';
import Exa, { type SearchResponse } from 'exa-js';
import { ContentExcerptService } from './content-excerpt.service';
import { cleanContent } from './content-cleaner';
import { rankSearchResults } from './search-result-ranker';
import {
  resolveSearchQuery,
  type SearchQueryResolution,
} from './search-query-resolver';
import type {
  ExtractStageResult,
  ExtractedDocument,
  NormalizedSearchResult,
  ProviderComparisonResult,
  SearchExecutionResult,
  SearchExtractComparisonResult,
  SearchProvider,
  SearchStageResult,
} from './search.types';
import { SEARCH_PROVIDERS } from './search.types';

type ExaHighlightsSearchResponse = SearchResponse<{
  highlights: {
    query?: string;
    maxCharacters: number;
  };
}>;
type ExaExtractSearchResponse = SearchResponse<{
  text: {
    maxCharacters: number;
    verbosity?: 'compact' | 'standard' | 'full';
    excludeSections?: Array<
      'navigation' | 'footer' | 'sidebar' | 'metadata' | 'banner'
    >;
  };
  highlights: {
    query?: string;
    maxCharacters: number;
  };
}>;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  private exaClient: Exa | null = null;

  private tavilyClient: TavilyClient | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly contentExcerptService: ContentExcerptService,
  ) {}

  async search(
    query: string,
    provider: SearchProvider,
  ): Promise<SearchExecutionResult> {
    const normalizedQuery = this.normalizeQuery(query);
    const queryResolution = resolveSearchQuery(normalizedQuery);
    const startedAt = Date.now();

    this.logger.log(
      `[${provider}] Dispatching search request for query: ${this.formatQueryForLog(queryResolution.effectiveQuery)}`,
    );

    try {
      switch (provider) {
        case 'tavily': {
          const raw = await this.searchWithTavily(
            queryResolution.effectiveQuery,
            5,
            queryResolution,
          );
          const latencyMs = Date.now() - startedAt;
          const normalized = rankSearchResults(
            this.normalizeTavilyResults(raw),
            queryResolution.executionHints,
          );

          this.logSuccess(provider, latencyMs, normalized.length);

          return {
            provider,
            query: normalizedQuery,
            effectiveQuery: queryResolution.effectiveQuery,
            appliedLocationFallback: queryResolution.appliedLocationFallback,
            notes: queryResolution.notes,
            latencyMs,
            normalized,
            raw,
          };
        }

        case 'exa': {
          const raw = await this.searchWithExa(
            queryResolution.effectiveQuery,
            5,
            queryResolution,
          );
          const latencyMs = Date.now() - startedAt;
          const normalized = rankSearchResults(
            this.normalizeExaResults(raw),
            queryResolution.executionHints,
          );

          this.logSuccess(provider, latencyMs, normalized.length);

          return {
            provider,
            query: normalizedQuery,
            effectiveQuery: queryResolution.effectiveQuery,
            appliedLocationFallback: queryResolution.appliedLocationFallback,
            notes: queryResolution.notes,
            latencyMs,
            normalized,
            raw,
          };
        }
      }
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      const message = this.getErrorMessage(error);

      this.logger.error(`[${provider}] Search failed: ${message}`);

      throw new InternalServerErrorException(message);
    }
  }

  async compareSearchThenExtract(
    query: string,
    searchLimit = 5,
    extractLimit = 3,
  ): Promise<SearchExtractComparisonResult> {
    const normalizedQuery = this.normalizeQuery(query);
    const queryResolution = resolveSearchQuery(normalizedQuery);
    const startedAt = Date.now();

    this.logger.log(
      `[compare] Starting search-then-extract comparison for query: ${this.formatQueryForLog(queryResolution.effectiveQuery)}`,
    );

    const providers = await Promise.all(
      SEARCH_PROVIDERS.map((provider) =>
        this.compareProvider(
          provider,
          queryResolution,
          searchLimit,
          extractLimit,
        ),
      ),
    );

    const totalLatencyMs = Date.now() - startedAt;

    this.logger.log(
      `[compare] Completed comparison in ${totalLatencyMs}ms for ${providers.length} provider(s).`,
    );

    return {
      query: normalizedQuery,
      effectiveQuery: queryResolution.effectiveQuery,
      appliedLocationFallback: queryResolution.appliedLocationFallback,
      notes: queryResolution.notes,
      searchLimit,
      extractLimit,
      totalLatencyMs,
      completedAt: new Date().toISOString(),
      providers,
    };
  }

  private async compareProvider(
    provider: SearchProvider,
    queryResolution: SearchQueryResolution,
    searchLimit: number,
    extractLimit: number,
  ): Promise<ProviderComparisonResult> {
    const startedAt = Date.now();

    try {
      switch (provider) {
        case 'tavily':
          return await this.compareTavily(
            queryResolution,
            searchLimit,
            extractLimit,
            startedAt,
          );
        case 'exa':
          return await this.compareExa(
            queryResolution,
            searchLimit,
            extractLimit,
            startedAt,
          );
      }
    } catch (error) {
      const message = this.getErrorMessage(error);

      this.logger.error(`[compare:${provider}] Provider comparison failed: ${message}`);

      return {
        provider,
        status: 'error',
        totalLatencyMs: Date.now() - startedAt,
        error: message,
        search: null,
        extract: null,
      };
    }
  }

  private async compareTavily(
    queryResolution: SearchQueryResolution,
    searchLimit: number,
    extractLimit: number,
    startedAt: number,
  ): Promise<ProviderComparisonResult> {
    const searchStartedAt = Date.now();
    const query = queryResolution.effectiveQuery;

    this.logger.log(`[compare:tavily] Search stage started.`);

    const searchRaw = await this.searchWithTavilyDiscovery(
      query,
      searchLimit,
      queryResolution,
    );
    const searchLatencyMs = Date.now() - searchStartedAt;
    const topResults = rankSearchResults(
      this.normalizeTavilyResults(searchRaw),
      queryResolution.executionHints,
    );
    const urlsToExtract = topResults.slice(0, extractLimit).map((result) => result.url);

    const searchStage: SearchStageResult = {
      latencyMs: searchLatencyMs,
      requestId: searchRaw.requestId,
      providerReportedLatencyMs: searchRaw.responseTime ?? null,
      usageCredits: searchRaw.usage?.credits ?? null,
      costDollarsTotal: null,
      resultCount: topResults.length,
      topResults,
      resolvedSearchType: null,
    };

    this.logger.log(
      `[compare:tavily] Search stage completed in ${searchLatencyMs}ms with ${topResults.length} result(s).`,
    );

    const extractStartedAt = Date.now();

    this.logger.log(
      `[compare:tavily] Extract stage started for ${urlsToExtract.length} URL(s).`,
    );

    const extractRaw =
      urlsToExtract.length > 0
        ? await this.extractWithTavily(urlsToExtract, query, queryResolution)
        : this.createEmptyTavilyExtractResponse();
    const extractLatencyMs = Date.now() - extractStartedAt;
    const documents = this.normalizeTavilyExtractedDocuments(
      extractRaw,
      searchRaw.results,
      query,
    );

    const extractStage: ExtractStageResult = {
      latencyMs: extractLatencyMs,
      requestId: extractRaw.requestId,
      providerReportedLatencyMs: extractRaw.responseTime ?? null,
      usageCredits: extractRaw.usage?.credits ?? null,
      costDollarsTotal: null,
      documentCount: documents.length,
      totalCharacters: documents.reduce(
        (total, document) => total + document.contentLength,
        0,
      ),
      failedSources: extractRaw.failedResults.map((result) => ({
        url: result.url,
        error: result.error,
      })),
      documents,
    };

    this.logger.log(
      `[compare:tavily] Extract stage completed in ${extractLatencyMs}ms with ${documents.length} document(s).`,
    );

    return {
      provider: 'tavily',
      status: 'ok',
      totalLatencyMs: Date.now() - startedAt,
      error: null,
      search: searchStage,
      extract: extractStage,
    };
  }

  private async compareExa(
    queryResolution: SearchQueryResolution,
    searchLimit: number,
    extractLimit: number,
    startedAt: number,
  ): Promise<ProviderComparisonResult> {
    const searchStartedAt = Date.now();
    const query = queryResolution.effectiveQuery;

    this.logger.log(`[compare:exa] Search stage started.`);

    const searchRaw = await this.searchWithExaDiscovery(
      query,
      searchLimit,
      queryResolution,
    );
    const searchLatencyMs = Date.now() - searchStartedAt;
    const topResults = rankSearchResults(
      this.normalizeExaResults(searchRaw),
      queryResolution.executionHints,
    );
    const urlsToExtract = topResults.slice(0, extractLimit).map((result) => result.url);

    const searchStage: SearchStageResult = {
      latencyMs: searchLatencyMs,
      requestId: searchRaw.requestId,
      providerReportedLatencyMs: searchRaw.searchTime ?? null,
      usageCredits: null,
      costDollarsTotal: searchRaw.costDollars?.total ?? null,
      resultCount: topResults.length,
      topResults,
      resolvedSearchType: searchRaw.resolvedSearchType ?? null,
    };

    this.logger.log(
      `[compare:exa] Search stage completed in ${searchLatencyMs}ms with ${topResults.length} result(s).`,
    );

    const extractStartedAt = Date.now();

    this.logger.log(
      `[compare:exa] Extract stage started for ${urlsToExtract.length} URL(s).`,
    );

    const extractRaw =
      urlsToExtract.length > 0
        ? await this.extractWithExa(urlsToExtract, query, queryResolution)
        : this.createEmptyExaExtractResponse();
    const extractLatencyMs = Date.now() - extractStartedAt;
    const documents = this.normalizeExaExtractedDocuments(
      extractRaw,
      topResults,
      query,
    );

    const extractedUrls = new Set(documents.map((document) => document.url));
    const failedStatusesByUrl = new Map(
      (extractRaw.statuses ?? [])
        .filter((status) => status.status === 'error')
        .map((status) => [status.id, status] as const),
    );
    const failedSources = urlsToExtract
      .filter((url) => !extractedUrls.has(url))
      .map((url) => {
        const failedStatus = failedStatusesByUrl.get(url);

        if (!failedStatus) {
          return {
            url,
            error: 'No content returned by Exa.',
          };
        }

        return {
          url,
          error: `Exa status: ${failedStatus.status}`,
        };
      });

    const extractStage: ExtractStageResult = {
      latencyMs: extractLatencyMs,
      requestId: extractRaw.requestId,
      providerReportedLatencyMs: extractRaw.searchTime ?? null,
      usageCredits: null,
      costDollarsTotal: extractRaw.costDollars?.total ?? null,
      documentCount: documents.length,
      totalCharacters: documents.reduce(
        (total, document) => total + document.contentLength,
        0,
      ),
      failedSources,
      documents,
    };

    this.logger.log(
      `[compare:exa] Extract stage completed in ${extractLatencyMs}ms with ${documents.length} document(s).`,
    );

    return {
      provider: 'exa',
      status: 'ok',
      totalLatencyMs: Date.now() - startedAt,
      error: null,
      search: searchStage,
      extract: extractStage,
    };
  }

  private async searchWithTavily(
    query: string,
    maxResults: number,
    queryResolution: SearchQueryResolution,
  ): Promise<TavilySearchResponse> {
    const tavilyClient = this.getTavilyClient();

    if (!tavilyClient) {
      throw new ServiceUnavailableException(
        'TAVILY_API_KEY is not configured.',
      );
    }

    return tavilyClient.search(query, {
      searchDepth:
        queryResolution.executionHints.intent === 'current-weather'
          ? 'advanced'
          : 'basic',
      maxResults,
      chunksPerSource:
        queryResolution.executionHints.intent === 'current-weather' ? 1 : undefined,
      country: queryResolution.executionHints.tavilyCountry ?? undefined,
      excludeDomains:
        queryResolution.executionHints.excludeDomains.length > 0
          ? queryResolution.executionHints.excludeDomains
          : undefined,
      includeAnswer: false,
      includeRawContent: false,
    });
  }

  private async searchWithTavilyDiscovery(
    query: string,
    maxResults: number,
    queryResolution: SearchQueryResolution,
  ): Promise<TavilySearchResponse> {
    const tavilyClient = this.getTavilyClient();

    if (!tavilyClient) {
      throw new ServiceUnavailableException(
        'TAVILY_API_KEY is not configured.',
      );
    }

    return tavilyClient.search(query, {
      searchDepth: 'advanced',
      maxResults,
      chunksPerSource:
        queryResolution.executionHints.intent === 'current-weather' ? 1 : 3,
      country: queryResolution.executionHints.tavilyCountry ?? undefined,
      excludeDomains:
        queryResolution.executionHints.excludeDomains.length > 0
          ? queryResolution.executionHints.excludeDomains
          : undefined,
      includeAnswer: false,
      includeRawContent: false,
      includeUsage: true,
    });
  }

  private async extractWithTavily(
    urls: string[],
    query: string,
    queryResolution: SearchQueryResolution,
  ): Promise<TavilyExtractResponse> {
    const tavilyClient = this.getTavilyClient();

    if (!tavilyClient) {
      throw new ServiceUnavailableException(
        'TAVILY_API_KEY is not configured.',
      );
    }

    return tavilyClient.extract(urls, {
      extractDepth: 'advanced',
      format: 'text',
      query,
      chunksPerSource:
        queryResolution.executionHints.intent === 'current-weather' ? 2 : 3,
      includeUsage: true,
    });
  }

  private async searchWithExa(
    query: string,
    numResults: number,
    queryResolution: SearchQueryResolution,
  ): Promise<ExaHighlightsSearchResponse> {
    const exaClient = this.getExaClient();

    return exaClient.search(query, {
      numResults,
      type: 'auto',
      userLocation: queryResolution.executionHints.exaUserLocation ?? undefined,
      excludeDomains:
        queryResolution.executionHints.excludeDomains.length > 0
          ? queryResolution.executionHints.excludeDomains
          : undefined,
      contents: {
        highlights: {
          query,
          maxCharacters: 420,
        },
        filterEmptyResults: true,
        maxAgeHours: queryResolution.executionHints.forceFreshContent ? 0 : undefined,
      },
    });
  }

  private async searchWithExaDiscovery(
    query: string,
    numResults: number,
    queryResolution: SearchQueryResolution,
  ): Promise<ExaHighlightsSearchResponse> {
    const exaClient = this.getExaClient();

    return exaClient.search(query, {
      numResults,
      type: 'auto',
      userLocation: queryResolution.executionHints.exaUserLocation ?? undefined,
      excludeDomains:
        queryResolution.executionHints.excludeDomains.length > 0
          ? queryResolution.executionHints.excludeDomains
          : undefined,
      contents: {
        highlights: {
          query,
          maxCharacters: 420,
        },
        filterEmptyResults: true,
        maxAgeHours: queryResolution.executionHints.forceFreshContent ? 0 : undefined,
      },
    });
  }

  private async extractWithExa(
    urls: string[],
    query: string,
    queryResolution: SearchQueryResolution,
  ): Promise<ExaExtractSearchResponse> {
    const exaClient = this.getExaClient();

    return exaClient.getContents(urls, {
      text: {
        maxCharacters:
          queryResolution.executionHints.intent === 'current-weather' ? 1800 : 2600,
        verbosity:
          queryResolution.executionHints.intent === 'current-weather'
            ? 'compact'
            : undefined,
        excludeSections:
          queryResolution.executionHints.intent === 'current-weather'
            ? ['navigation', 'footer', 'sidebar', 'metadata', 'banner']
            : undefined,
      },
      highlights: {
        query,
        maxCharacters:
          queryResolution.executionHints.intent === 'current-weather' ? 900 : 1200,
      },
      filterEmptyResults: true,
      maxAgeHours: queryResolution.executionHints.forceFreshContent ? 0 : undefined,
    });
  }

  private getExaClient(): Exa {
    if (this.exaClient) {
      return this.exaClient;
    }

    const apiKey = this.configService.get<string>('EXA_API_KEY');

    if (!apiKey) {
      throw new ServiceUnavailableException('EXA_API_KEY is not configured.');
    }

    this.exaClient = new Exa(apiKey);

    return this.exaClient;
  }

  private getTavilyClient(): TavilyClient | null {
    if (this.tavilyClient) {
      return this.tavilyClient;
    }

    const apiKey = this.configService.get<string>('TAVILY_API_KEY');

    if (!apiKey) {
      return null;
    }

    this.tavilyClient = tavily({ apiKey });

    return this.tavilyClient;
  }

  private normalizeTavilyResults(
    raw: TavilySearchResponse,
  ): NormalizedSearchResult[] {
    return raw.results.map((result) => ({
      title: result.title,
      url: result.url,
      snippet: this.normalizeSearchSnippet(result.content),
      score: result.score,
      publishedAt: result.publishedDate || null,
    }));
  }

  private normalizeExaResults(
    raw: ExaHighlightsSearchResponse,
  ): NormalizedSearchResult[] {
    return raw.results.map((result) => ({
      title: result.title ?? result.url,
      url: result.url,
      snippet: this.normalizeSearchSnippet(this.getExaSnippet(result)),
      score: result.score ?? null,
      publishedAt: result.publishedDate ?? null,
    }));
  }

  private normalizeTavilyExtractedDocuments(
    raw: TavilyExtractResponse,
    searchResults: TavilySearchResponse['results'],
    query: string,
  ): ExtractedDocument[] {
    const searchResultsByUrl = new Map(
      searchResults.map((result) => [result.url, result] as const),
    );

    return raw.results.map((result) => {
      const searchResult = searchResultsByUrl.get(result.url);
      const content = result.rawContent ?? '';

      return {
        title: result.title ?? searchResult?.title ?? result.url,
        url: result.url,
        publishedAt: searchResult?.publishedDate ?? null,
        score: searchResult?.score ?? null,
        content,
        contentLength: content.length,
        excerpt: this.contentExcerptService.buildExcerpt(content, query),
      };
    });
  }

  private normalizeExaExtractedDocuments(
    raw: ExaExtractSearchResponse,
    searchResults: NormalizedSearchResult[],
    query: string,
  ): ExtractedDocument[] {
    const searchResultsByUrl = new Map(
      searchResults.map((result) => [result.url, result] as const),
    );

    return raw.results.map((result) => {
      const searchResult = searchResultsByUrl.get(result.url);
      const content = this.getExaContent(result);

      return {
        title: result.title ?? searchResult?.title ?? result.url,
        url: result.url,
        publishedAt: result.publishedDate ?? searchResult?.publishedAt ?? null,
        score: result.score ?? searchResult?.score ?? null,
        content,
        contentLength: content.length,
        excerpt: this.buildExcerptFromProviderContent(
          result.highlights,
          content,
          query,
        ),
      };
    });
  }

  private createEmptyTavilyExtractResponse(): TavilyExtractResponse {
    return {
      results: [],
      failedResults: [],
      responseTime: 0,
      usage: {
        credits: 0,
      },
      requestId: 'skipped-no-urls',
    };
  }

  private createEmptyExaExtractResponse(): ExaExtractSearchResponse {
    return {
      results: [],
      requestId: 'skipped-no-urls',
      statuses: [],
      searchTime: 0,
    };
  }

  private logSuccess(
    provider: SearchProvider,
    latencyMs: number,
    resultCount: number,
  ): void {
    this.logger.log(
      `[${provider}] Search completed in ${latencyMs}ms with ${resultCount} normalized result(s).`,
    );
  }

  private normalizeQuery(query: string): string {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      throw new BadRequestException('Query must not be empty.');
    }

    return normalizedQuery;
  }

  private normalizeSearchSnippet(snippet: string): string {
    const cleanedSnippet = cleanContent(snippet);

    if (!cleanedSnippet) {
      return '';
    }

    if (cleanedSnippet.length <= 420) {
      return cleanedSnippet;
    }

    return `${cleanedSnippet.slice(0, 417).trimEnd()}...`;
  }

  private getExaSnippet(result: {
    text?: string | null;
    highlights?: string[] | null;
  }): string {
    const highlightsText = this.joinHighlights(result.highlights);

    if (highlightsText) {
      return highlightsText;
    }

    return result.text ?? '';
  }

  private getExaContent(result: {
    text?: string | null;
    highlights?: string[] | null;
  }): string {
    const text = result.text ?? '';

    if (text) {
      return text;
    }

    return this.joinHighlights(result.highlights);
  }

  private buildExcerptFromProviderContent(
    highlights: string[] | null | undefined,
    content: string,
    query: string,
  ): string {
    const highlightsText = cleanContent(this.joinHighlights(highlights));

    if (highlightsText) {
      return highlightsText.length <= 900
        ? highlightsText
        : `${highlightsText.slice(0, 897).trimEnd()}...`;
    }

    return this.contentExcerptService.buildExcerpt(content, query);
  }

  private joinHighlights(highlights: string[] | null | undefined): string {
    if (!Array.isArray(highlights) || highlights.length === 0) {
      return '';
    }

    return highlights
      .map((highlight) => highlight.trim())
      .filter((highlight) => highlight.length > 0)
      .join(' ');
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Search provider request failed.';
  }

  private formatQueryForLog(query: string): string {
    return query.length > 180 ? `${query.slice(0, 177)}...` : query;
  }
}
