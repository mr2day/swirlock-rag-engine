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
  type SearchIntent,
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
  StructuredSummary,
  WeatherSnapshot,
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
  summary: {
    query?: string;
    schema?: Record<string, unknown>;
  };
}>;

const EXA_CURRENT_WEATHER_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    location: { type: 'string' },
    observationTime: { type: 'string' },
    condition: { type: 'string' },
    temperature: { type: 'string' },
    feelsLike: { type: 'string' },
    humidity: { type: 'string' },
    wind: { type: 'string' },
    high: { type: 'string' },
    low: { type: 'string' },
  },
  required: ['temperature'],
} satisfies Record<string, unknown>;

const EXA_MARKET_PRICE_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    asset: { type: 'string' },
    quoteTime: { type: 'string' },
    marketStatus: { type: 'string' },
    price: { type: 'string' },
    currency: { type: 'string' },
    change: { type: 'string' },
    percentChange: { type: 'string' },
    exchange: { type: 'string' },
    dayRange: { type: 'string' },
  },
  required: ['price'],
} satisfies Record<string, unknown>;

const EXA_SPORTS_SCORE_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    event: { type: 'string' },
    competition: { type: 'string' },
    status: { type: 'string' },
    score: { type: 'string' },
    teamA: { type: 'string' },
    teamB: { type: 'string' },
    winner: { type: 'string' },
    period: { type: 'string' },
    eventTime: { type: 'string' },
  },
  required: ['status'],
} satisfies Record<string, unknown>;

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

      this.logger.error(
        `[compare:${provider}] Provider comparison failed: ${message}`,
      );

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
    const urlsToExtract = topResults
      .slice(0, extractLimit)
      .map((result) => result.url);

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
      queryResolution.executionHints.intent,
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
    const urlsToExtract = topResults
      .slice(0, extractLimit)
      .map((result) => result.url);

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
      queryResolution.executionHints.intent,
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
      searchDepth: queryResolution.executionHints.forceFreshContent
        ? 'advanced'
        : 'basic',
      topic: queryResolution.executionHints.tavilyTopic,
      maxResults,
      chunksPerSource: queryResolution.executionHints.forceFreshContent
        ? 1
        : undefined,
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
      topic: queryResolution.executionHints.tavilyTopic,
      maxResults,
      chunksPerSource: queryResolution.executionHints.forceFreshContent ? 1 : 3,
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
      chunksPerSource: queryResolution.executionHints.forceFreshContent ? 2 : 3,
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
      category: queryResolution.executionHints.exaCategory ?? undefined,
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
        maxAgeHours: queryResolution.executionHints.forceFreshContent
          ? 0
          : undefined,
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
      category: queryResolution.executionHints.exaCategory ?? undefined,
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
        maxAgeHours: queryResolution.executionHints.forceFreshContent
          ? 0
          : undefined,
      },
    });
  }

  private async extractWithExa(
    urls: string[],
    query: string,
    queryResolution: SearchQueryResolution,
  ): Promise<ExaExtractSearchResponse> {
    const exaClient = this.getExaClient();

    const response = await exaClient.getContents(urls, {
      text: {
        maxCharacters:
          queryResolution.executionHints.intent === 'current-weather'
            ? 1800
            : 2600,
        verbosity:
          queryResolution.executionHints.intent === 'current-weather'
            ? 'compact'
            : undefined,
        excludeSections:
          queryResolution.executionHints.intent !== 'general'
            ? ['navigation', 'footer', 'sidebar', 'metadata', 'banner']
            : undefined,
      },
      highlights: {
        query,
        maxCharacters:
          queryResolution.executionHints.intent !== 'general' ? 900 : 1200,
      },
      summary: this.getExaSummaryRequest(queryResolution.executionHints.intent),
      filterEmptyResults: true,
      maxAgeHours: queryResolution.executionHints.forceFreshContent
        ? 0
        : undefined,
    });

    return response as ExaExtractSearchResponse;
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
    intent: SearchIntent,
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
        excerpt: this.contentExcerptService.buildExcerpt(
          content,
          query,
          intent,
        ),
        providerSummary: null,
        structuredSummary: null,
        weatherSnapshot: null,
      };
    });
  }

  private normalizeExaExtractedDocuments(
    raw: ExaExtractSearchResponse,
    searchResults: NormalizedSearchResult[],
    query: string,
    intent: SearchIntent,
  ): ExtractedDocument[] {
    const searchResultsByUrl = new Map(
      searchResults.map((result) => [result.url, result] as const),
    );

    return raw.results.map((result) => {
      const searchResult = searchResultsByUrl.get(result.url);
      const content = this.getExaContent(result);
      const weatherSnapshot =
        intent === 'current-weather'
          ? this.parseWeatherSnapshot(result.summary)
          : null;
      const providerSummary = this.normalizeProviderSummary(result.summary);
      const structuredSummary = this.parseStructuredSummary(
        intent,
        result.summary,
        weatherSnapshot,
      );

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
          intent,
          structuredSummary,
        ),
        providerSummary,
        structuredSummary,
        weatherSnapshot,
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
    intent: SearchIntent,
    structuredSummary: StructuredSummary | null = null,
  ): string {
    const structuredSummaryExcerpt =
      this.formatStructuredSummary(structuredSummary);

    if (structuredSummaryExcerpt) {
      return structuredSummaryExcerpt;
    }

    const highlightsText = cleanContent(this.joinHighlights(highlights));

    if (highlightsText) {
      return highlightsText.length <= 900
        ? highlightsText
        : `${highlightsText.slice(0, 897).trimEnd()}...`;
    }

    return this.contentExcerptService.buildExcerpt(content, query, intent);
  }

  private getExaSummaryRequest(
    intent: SearchIntent,
  ): { query: string; schema: Record<string, unknown> } | undefined {
    switch (intent) {
      case 'current-weather':
        return {
          query:
            'Extract the current weather conditions only. Return current temperature, feels like, humidity, wind, condition, local observation time, and today high/low if present.',
          schema: EXA_CURRENT_WEATHER_SUMMARY_SCHEMA,
        };

      case 'market-price':
        return {
          query:
            'Extract the current market quote only. Return the asset name, current price, quote time, currency, change, percent change, market status, exchange, and day range if present.',
          schema: EXA_MARKET_PRICE_SUMMARY_SCHEMA,
        };

      case 'sports-score':
        return {
          query:
            'Extract the latest score update only. Return the event, competition, current status, score, both teams or players, winner if final, period or quarter if live, and event time if present.',
          schema: EXA_SPORTS_SCORE_SUMMARY_SCHEMA,
        };

      default:
        return undefined;
    }
  }

  private normalizeProviderSummary(
    summary: string | null | undefined,
  ): string | null {
    const normalizedSummary = typeof summary === 'string' ? summary.trim() : '';

    return normalizedSummary || null;
  }

  private parseStructuredSummary(
    intent: SearchIntent,
    summary: string | null | undefined,
    weatherSnapshot: WeatherSnapshot | null,
  ): StructuredSummary | null {
    switch (intent) {
      case 'current-weather':
        return this.buildWeatherStructuredSummary(weatherSnapshot);
      case 'market-price':
        return this.parseMarketPriceStructuredSummary(summary);
      case 'sports-score':
        return this.parseSportsScoreStructuredSummary(summary);
      default:
        return null;
    }
  }

  private parseWeatherSnapshot(
    summary: string | null | undefined,
  ): WeatherSnapshot | null {
    const parsed = this.parseSummaryJson(summary);

    if (!parsed) {
      return null;
    }

    const snapshot: WeatherSnapshot = {
      location: this.getOptionalString(parsed.location),
      observationTime: this.getOptionalString(parsed.observationTime),
      condition: this.getOptionalString(parsed.condition),
      temperature: this.getOptionalString(parsed.temperature),
      feelsLike: this.getOptionalString(parsed.feelsLike),
      humidity: this.getOptionalString(parsed.humidity),
      wind: this.getOptionalString(parsed.wind),
      high: this.getOptionalString(parsed.high),
      low: this.getOptionalString(parsed.low),
    };

    return Object.values(snapshot).some((value) => value !== null)
      ? snapshot
      : null;
  }

  private buildWeatherStructuredSummary(
    snapshot: WeatherSnapshot | null,
  ): StructuredSummary | null {
    if (!snapshot) {
      return null;
    }

    return this.createStructuredSummary('weather', snapshot.location, [
      ['As of', snapshot.observationTime],
      ['Condition', snapshot.condition],
      ['Temperature', snapshot.temperature],
      ['Feels like', snapshot.feelsLike],
      ['Humidity', snapshot.humidity],
      ['Wind', snapshot.wind],
      [
        'High / Low',
        snapshot.high || snapshot.low
          ? `${snapshot.high ?? 'n/a'} / ${snapshot.low ?? 'n/a'}`
          : null,
      ],
    ]);
  }

  private parseMarketPriceStructuredSummary(
    summary: string | null | undefined,
  ): StructuredSummary | null {
    const parsed = this.parseSummaryJson(summary);

    if (!parsed) {
      return null;
    }

    return this.createStructuredSummary(
      'market-price',
      this.getOptionalString(parsed.asset) ?? 'Current market quote',
      [
        ['As of', this.getOptionalString(parsed.quoteTime)],
        ['Price', this.getOptionalString(parsed.price)],
        ['Currency', this.getOptionalString(parsed.currency)],
        ['Change', this.getOptionalString(parsed.change)],
        ['Change %', this.getOptionalString(parsed.percentChange)],
        ['Status', this.getOptionalString(parsed.marketStatus)],
        ['Exchange', this.getOptionalString(parsed.exchange)],
        ['Range', this.getOptionalString(parsed.dayRange)],
      ],
    );
  }

  private parseSportsScoreStructuredSummary(
    summary: string | null | undefined,
  ): StructuredSummary | null {
    const parsed = this.parseSummaryJson(summary);

    if (!parsed) {
      return null;
    }

    const teamA = this.getOptionalString(parsed.teamA);
    const teamB = this.getOptionalString(parsed.teamB);
    const event =
      this.getOptionalString(parsed.event) ??
      [teamA, teamB]
        .filter((value): value is string => Boolean(value))
        .join(' vs ');

    return this.createStructuredSummary(
      'sports-score',
      event || 'Score update',
      [
        ['Competition', this.getOptionalString(parsed.competition)],
        ['Status', this.getOptionalString(parsed.status)],
        ['Score', this.getOptionalString(parsed.score)],
        ['Period', this.getOptionalString(parsed.period)],
        ['Winner', this.getOptionalString(parsed.winner)],
        ['Event time', this.getOptionalString(parsed.eventTime)],
      ],
    );
  }

  private createStructuredSummary(
    type: StructuredSummary['type'],
    heading: string | null,
    entries: Array<[string, string | null]>,
  ): StructuredSummary | null {
    const fields = entries
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([label, value]) => ({
        label,
        value,
      }));

    if (!heading && fields.length === 0) {
      return null;
    }

    return {
      type,
      heading,
      fields,
    };
  }

  private formatStructuredSummary(summary: StructuredSummary | null): string {
    if (!summary) {
      return '';
    }

    const segments = [
      summary.heading,
      ...summary.fields.map((field) => `${field.label}: ${field.value}`),
    ].filter((segment): segment is string => Boolean(segment));

    return segments.join('. ');
  }

  private parseSummaryJson(
    summary: string | null | undefined,
  ): Record<string, unknown> | null {
    if (!summary) {
      return null;
    }

    try {
      return JSON.parse(summary) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private getOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = value.trim();

    if (!normalized) {
      return null;
    }

    if (/^(null|n\/a|none|unknown)$/i.test(normalized)) {
      return null;
    }

    return normalized;
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
    return error instanceof Error
      ? error.message
      : 'Search provider request failed.';
  }

  private formatQueryForLog(query: string): string {
    return query.length > 180 ? `${query.slice(0, 177)}...` : query;
  }
}
