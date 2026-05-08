import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContentExcerptService } from './content-excerpt.service';
import { cleanContent } from './content-cleaner';
import type {
  ExtractStageResult,
  ExtractedDocument,
  NormalizedSearchResult,
  SearchExtractExecutionResult,
  SearchExtractInspectionResult,
  SearchExtractProgressHandler,
  SearchStageResult,
} from './search.types';

interface WikipediaConfiguration {
  enabled: boolean;
  baseUrl: string;
  userAgent: string;
  searchLimit: number;
  extractLimit: number;
  timeoutMs: number;
}

interface MediaWikiSearchHit {
  ns?: number;
  title?: string;
  pageid?: number;
  size?: number;
  wordcount?: number;
  snippet?: string;
  timestamp?: string;
}

interface MediaWikiSearchResponse {
  query?: {
    search?: MediaWikiSearchHit[];
  };
}

interface MediaWikiPage {
  pageid?: number;
  title?: string;
  extract?: string;
  fullurl?: string;
  canonicalurl?: string;
  touched?: string;
}

interface MediaWikiExtractResponse {
  query?: {
    pages?: Record<string, MediaWikiPage>;
  };
}

const PROVIDER_NAME = 'wikipedia';

@Injectable()
export class WikipediaSearchService {
  private readonly logger = new Logger(WikipediaSearchService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly contentExcerptService: ContentExcerptService,
  ) {}

  getConfiguration(): WikipediaConfiguration {
    const rawEnabled = (
      this.configService.get<string>('WIKIPEDIA_SEARCH_ENABLED') ?? 'true'
    )
      .toString()
      .toLowerCase();
    const enabled = rawEnabled === 'true' || rawEnabled === '1';

    const baseUrl = (
      this.configService.get<string>('WIKIPEDIA_BASE_URL') ??
      'https://en.wikipedia.org'
    ).replace(/\/$/, '');
    const userAgent =
      this.configService.get<string>('WIKIPEDIA_USER_AGENT') ??
      'swirlock-rag-engine/1.0 (https://github.com/mr2day/swirlock-rag-engine)';
    const searchLimit = this.parsePositiveInt(
      this.configService.get<string>('WIKIPEDIA_SEARCH_LIMIT'),
      5,
    );
    const extractLimit = this.parsePositiveInt(
      this.configService.get<string>('WIKIPEDIA_EXTRACT_LIMIT'),
      3,
    );
    const timeoutMs = this.parsePositiveInt(
      this.configService.get<string>('WIKIPEDIA_TIMEOUT_MS'),
      15000,
    );

    return {
      enabled,
      baseUrl,
      userAgent,
      searchLimit,
      extractLimit,
      timeoutMs: Math.max(1000, timeoutMs),
    };
  }

  async searchThenExtract(
    query: string,
    searchLimit?: number,
    extractLimit?: number,
    progress?: SearchExtractProgressHandler,
  ): Promise<SearchExtractInspectionResult> {
    const config = this.getConfiguration();
    const requestedSearchLimit =
      typeof searchLimit === 'number'
        ? Math.max(0, searchLimit)
        : config.searchLimit;
    const requestedExtractLimit =
      typeof extractLimit === 'number'
        ? Math.max(0, extractLimit)
        : config.extractLimit;
    const effectiveSearchLimit = Math.min(
      requestedSearchLimit,
      config.searchLimit,
    );
    const effectiveExtractLimit = Math.min(
      requestedExtractLimit,
      effectiveSearchLimit,
    );

    const startedAt = Date.now();
    const trimmed = query.trim();

    const skip = (
      reason: 'disabled' | 'empty-query',
    ): SearchExtractInspectionResult => ({
      query: trimmed,
      searchLimit: effectiveSearchLimit,
      extractLimit: effectiveExtractLimit,
      totalLatencyMs: 0,
      completedAt: new Date().toISOString(),
      status: 'ok',
      error: reason === 'disabled' ? 'Wikipedia provider is disabled.' : null,
      search: null,
      extract: null,
    });

    if (!config.enabled) {
      return skip('disabled');
    }
    if (!trimmed || effectiveSearchLimit === 0) {
      return skip('empty-query');
    }

    try {
      const result = await this.runSearchThenExtract(
        trimmed,
        effectiveSearchLimit,
        effectiveExtractLimit,
        config,
        startedAt,
        progress,
      );

      return {
        query: trimmed,
        searchLimit: effectiveSearchLimit,
        extractLimit: effectiveExtractLimit,
        completedAt: new Date().toISOString(),
        ...result,
      };
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.warn(`[wikipedia] search-then-extract failed: ${message}`);
      return {
        query: trimmed,
        searchLimit: effectiveSearchLimit,
        extractLimit: effectiveExtractLimit,
        totalLatencyMs: Date.now() - startedAt,
        completedAt: new Date().toISOString(),
        status: 'error',
        error: message,
        search: null,
        extract: null,
      };
    }
  }

  private async runSearchThenExtract(
    query: string,
    searchLimit: number,
    extractLimit: number,
    config: WikipediaConfiguration,
    startedAt: number,
    progress?: SearchExtractProgressHandler,
  ): Promise<SearchExtractExecutionResult> {
    await progress?.({
      type: 'search_started',
      query,
      searchLimit,
    });

    const searchStartedAt = Date.now();
    const hits = await this.wikipediaSearch(query, searchLimit, config);
    const topResults = this.normalizeSearchHits(hits, config);
    const searchLatencyMs = Date.now() - searchStartedAt;

    const searchStage: SearchStageResult = {
      latencyMs: searchLatencyMs,
      requestId: null,
      providerReportedLatencyMs: null,
      usageCredits: null,
      costDollarsTotal: null,
      resultCount: topResults.length,
      topResults,
      resolvedSearchType: 'wikipedia',
    };

    await progress?.({
      type: 'search_completed',
      query,
      search: searchStage,
    });

    const pageIdsToExtract = hits
      .slice(0, extractLimit)
      .map((hit) => hit.pageid)
      .filter((id): id is number => typeof id === 'number');

    const urlsToExtract = topResults
      .slice(0, extractLimit)
      .map((result) => result.url);

    await progress?.({
      type: 'extract_started',
      query,
      urls: urlsToExtract,
      extractLimit,
    });

    const extractStartedAt = Date.now();
    const pages =
      pageIdsToExtract.length > 0
        ? await this.wikipediaExtract(pageIdsToExtract, config)
        : new Map<number, MediaWikiPage>();
    const extractLatencyMs = Date.now() - extractStartedAt;

    const documents: ExtractedDocument[] = [];
    const failedSources: ExtractStageResult['failedSources'] = [];

    for (const hit of hits.slice(0, extractLimit)) {
      const pageId = hit.pageid;
      const page = pageId !== undefined ? pages.get(pageId) : undefined;
      const fallbackUrl = this.buildArticleUrl(config.baseUrl, hit.title);
      const url = page?.fullurl ?? page?.canonicalurl ?? fallbackUrl ?? '';

      const cleaned = cleanContent(page?.extract ?? '');
      if (!cleaned) {
        failedSources.push({
          url: url || hit.title || '(unknown)',
          error: 'Wikipedia returned no plain-text extract for this page.',
        });
        continue;
      }

      const truncated = this.truncate(cleaned, 12000);
      const excerpt = this.contentExcerptService.buildExcerpt(truncated, query);

      documents.push({
        title: page?.title ?? hit.title ?? url,
        url,
        publishedAt: page?.touched ?? hit.timestamp ?? null,
        score: null,
        content: truncated,
        contentLength: truncated.length,
        excerpt,
        providerSummary: null,
        structuredSummary: null,
        weatherSnapshot: null,
      });
    }

    const extractStage: ExtractStageResult = {
      latencyMs: extractLatencyMs,
      requestId: null,
      providerReportedLatencyMs: null,
      usageCredits: null,
      costDollarsTotal: null,
      documentCount: documents.length,
      totalCharacters: documents.reduce(
        (total, document) => total + document.contentLength,
        0,
      ),
      failedSources,
      documents,
    };

    await progress?.({
      type: 'extract_completed',
      query,
      extract: extractStage,
    });

    return {
      status: 'ok',
      totalLatencyMs: Date.now() - startedAt,
      error: null,
      search: searchStage,
      extract: extractStage,
    };
  }

  private async wikipediaSearch(
    query: string,
    limit: number,
    config: WikipediaConfiguration,
  ): Promise<MediaWikiSearchHit[]> {
    const url = new URL('/w/api.php', config.baseUrl);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', String(limit));
    url.searchParams.set('srprop', 'snippet|titlesnippet|wordcount|timestamp');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('origin', '*');

    const response = (await this.fetchJson(
      url,
      config,
    )) as MediaWikiSearchResponse;
    return response.query?.search ?? [];
  }

  private async wikipediaExtract(
    pageIds: number[],
    config: WikipediaConfiguration,
  ): Promise<Map<number, MediaWikiPage>> {
    const url = new URL('/w/api.php', config.baseUrl);
    url.searchParams.set('action', 'query');
    url.searchParams.set('prop', 'extracts|info');
    url.searchParams.set('inprop', 'url');
    url.searchParams.set('explaintext', '1');
    url.searchParams.set('exsectionformat', 'plain');
    url.searchParams.set('redirects', '1');
    url.searchParams.set('pageids', pageIds.join('|'));
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('origin', '*');

    const response = (await this.fetchJson(
      url,
      config,
    )) as MediaWikiExtractResponse;
    const pages = response.query?.pages ?? {};
    const out = new Map<number, MediaWikiPage>();
    if (Array.isArray(pages)) {
      for (const page of pages as MediaWikiPage[]) {
        if (typeof page.pageid === 'number') out.set(page.pageid, page);
      }
    } else {
      for (const value of Object.values(pages)) {
        if (typeof value.pageid === 'number') out.set(value.pageid, value);
      }
    }
    return out;
  }

  private async fetchJson(
    url: URL,
    config: WikipediaConfiguration,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': config.userAgent,
          Accept: 'application/json',
          'Api-User-Agent': config.userAgent,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `Wikipedia API responded with HTTP ${response.status}: ${response.statusText}`,
        );
      }
      return (await response.json()) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeSearchHits(
    hits: MediaWikiSearchHit[],
    config: WikipediaConfiguration,
  ): NormalizedSearchResult[] {
    const out: NormalizedSearchResult[] = [];
    for (const hit of hits) {
      const url = this.buildArticleUrl(config.baseUrl, hit.title);
      if (!url) continue;
      const snippet = cleanContent(this.stripHtml(hit.snippet ?? ''));
      out.push({
        title: hit.title ?? url,
        url,
        snippet: this.truncate(snippet, 420),
        score: null,
        publishedAt: hit.timestamp ?? null,
      });
    }
    return out;
  }

  private stripHtml(value: string): string {
    return value
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  private buildArticleUrl(baseUrl: string, title?: string): string {
    if (!title) return '';
    const encoded = encodeURIComponent(title.replace(/ /g, '_'));
    return `${baseUrl}/wiki/${encoded}`;
  }

  private truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
  }

  private parsePositiveInt(
    value: string | undefined,
    fallback: number,
  ): number {
    if (value === undefined) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return 'Wikipedia request timed out.';
      }
      return error.message;
    }
    return 'Wikipedia request failed.';
  }
}

export const WIKIPEDIA_PROVIDER_NAME = PROVIDER_NAME;
