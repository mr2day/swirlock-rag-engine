import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Exa, { type SearchResponse } from 'exa-js';
import { ContentExcerptService } from './content-excerpt.service';
import { cleanContent } from './content-cleaner';
import type {
  ExtractStageResult,
  ExtractedDocument,
  NormalizedSearchResult,
  SearchExecutionResult,
  SearchExtractExecutionResult,
  SearchExtractInspectionResult,
  SearchExtractProgressHandler,
  SearchStageResult,
} from './search.types';

type ExaHighlightsSearchResponse = SearchResponse<{
  highlights: {
    query?: string;
    maxCharacters: number;
  };
}>;
type ExaExtractSearchResponse = SearchResponse<{
  text: {
    maxCharacters: number;
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

  constructor(
    private readonly configService: ConfigService,
    private readonly contentExcerptService: ContentExcerptService,
  ) {}

  async search(query: string): Promise<SearchExecutionResult> {
    const normalizedQuery = this.normalizeQuery(query);
    const startedAt = Date.now();

    this.logger.log(
      `[exa] Dispatching search request for query: ${this.formatQueryForLog(normalizedQuery)}`,
    );

    try {
      const raw = await this.searchWithExa(normalizedQuery, 5);
      const latencyMs = Date.now() - startedAt;
      const normalized = this.normalizeExaResults(raw);

      this.logSuccess(latencyMs, normalized.length);

      return {
        query: normalizedQuery,
        latencyMs,
        normalized,
        raw,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      const message = this.getErrorMessage(error);

      this.logger.error(`[exa] Search failed: ${message}`);

      throw new InternalServerErrorException(message);
    }
  }

  async searchThenExtract(
    query: string,
    searchLimit = 5,
    extractLimit = 3,
    progress?: SearchExtractProgressHandler,
  ): Promise<SearchExtractInspectionResult> {
    const normalizedQuery = this.normalizeQuery(query);
    const startedAt = Date.now();

    this.logger.log(
      `[extract] Starting search-then-extract run for query: ${this.formatQueryForLog(normalizedQuery)}`,
    );

    const result = await this.runExaSearchThenExtract(
      normalizedQuery,
      searchLimit,
      extractLimit,
      startedAt,
      progress,
    );

    this.logger.log(
      `[extract] Completed search-then-extract run in ${result.totalLatencyMs}ms.`,
    );

    return {
      query: normalizedQuery,
      searchLimit,
      extractLimit,
      completedAt: new Date().toISOString(),
      ...result,
    };
  }

  private async runExaSearchThenExtract(
    query: string,
    searchLimit: number,
    extractLimit: number,
    startedAt: number,
    progress?: SearchExtractProgressHandler,
  ): Promise<SearchExtractExecutionResult> {
    try {
      return await this.searchThenExtractWithExa(
        query,
        searchLimit,
        extractLimit,
        startedAt,
        progress,
      );
    } catch (error) {
      const message = this.getErrorMessage(error);

      this.logger.error(`[extract:exa] Search/extract run failed: ${message}`);

      return {
        status: 'error',
        totalLatencyMs: Date.now() - startedAt,
        error: message,
        search: null,
        extract: null,
      };
    }
  }

  private async searchThenExtractWithExa(
    query: string,
    searchLimit: number,
    extractLimit: number,
    startedAt: number,
    progress?: SearchExtractProgressHandler,
  ): Promise<SearchExtractExecutionResult> {
    const searchStartedAt = Date.now();

    this.logger.log(`[extract:exa] Search stage started.`);
    await progress?.({
      type: 'search_started',
      query,
      searchLimit,
    });

    const searchRaw = await this.searchWithExa(query, searchLimit);
    const searchLatencyMs = Date.now() - searchStartedAt;
    const topResults = this.normalizeExaResults(searchRaw);
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
      `[extract:exa] Search stage completed in ${searchLatencyMs}ms with ${topResults.length} result(s).`,
    );
    await progress?.({
      type: 'search_completed',
      query,
      search: searchStage,
    });

    const extractStartedAt = Date.now();

    this.logger.log(
      `[extract:exa] Extract stage started for ${urlsToExtract.length} URL(s).`,
    );
    await progress?.({
      type: 'extract_started',
      query,
      urls: urlsToExtract,
      extractLimit,
    });

    const extractRaw =
      urlsToExtract.length > 0
        ? await this.extractWithExa(urlsToExtract, query)
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
      `[extract:exa] Extract stage completed in ${extractLatencyMs}ms with ${documents.length} document(s).`,
    );
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

  private async searchWithExa(
    query: string,
    numResults: number,
  ): Promise<ExaHighlightsSearchResponse> {
    const exaClient = this.getExaClient();

    return exaClient.search(query, {
      numResults,
      type: 'auto',
      contents: {
        highlights: {
          query,
          maxCharacters: 420,
        },
        filterEmptyResults: true,
      },
    });
  }

  private async extractWithExa(
    urls: string[],
    query: string,
  ): Promise<ExaExtractSearchResponse> {
    const exaClient = this.getExaClient();

    const response = await exaClient.getContents(urls, {
      text: {
        maxCharacters: 2600,
      },
      highlights: {
        query,
        maxCharacters: 1200,
      },
      filterEmptyResults: true,
    });

    return response;
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
        providerSummary: null,
        structuredSummary: null,
        weatherSnapshot: null,
      };
    });
  }

  private createEmptyExaExtractResponse(): ExaExtractSearchResponse {
    return {
      results: [],
      requestId: 'skipped-no-urls',
      statuses: [],
      searchTime: 0,
    };
  }

  private logSuccess(latencyMs: number, resultCount: number): void {
    this.logger.log(
      `[exa] Search completed in ${latencyMs}ms with ${resultCount} normalized result(s).`,
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
    return error instanceof Error
      ? error.message
      : 'Search provider request failed.';
  }

  private formatQueryForLog(query: string): string {
    return query.length > 180 ? `${query.slice(0, 177)}...` : query;
  }
}
