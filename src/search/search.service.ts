import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { tavily, type TavilyClient, type TavilySearchResponse } from '@tavily/core';
import Exa from 'exa-js';
import type { SearchResponse } from 'exa-js';
import type {
  NormalizedSearchResult,
  SearchExecutionResult,
  SearchProvider,
} from './search.types';

type ExaTextSearchResponse = SearchResponse<{
  text: {
    maxCharacters: number;
  };
}>;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  private exaClient: Exa | null = null;

  private tavilyClient: TavilyClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  async search(
    query: string,
    provider: SearchProvider,
  ): Promise<SearchExecutionResult> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      throw new BadRequestException('Query must not be empty.');
    }

    const startedAt = Date.now();

    this.logger.log(
      `[${provider}] Dispatching search request for query: ${this.formatQueryForLog(normalizedQuery)}`,
    );

    try {
      switch (provider) {
        case 'tavily': {
          const raw = await this.searchWithTavily(normalizedQuery);
          const latencyMs = Date.now() - startedAt;
          const normalized = this.normalizeTavilyResults(raw);

          this.logSuccess(provider, latencyMs, normalized.length);

          return {
            provider,
            query: normalizedQuery,
            latencyMs,
            normalized,
            raw,
          };
        }

        case 'exa': {
          const raw = await this.searchWithExa(normalizedQuery);
          const latencyMs = Date.now() - startedAt;
          const normalized = this.normalizeExaResults(raw);

          this.logSuccess(provider, latencyMs, normalized.length);

          return {
            provider,
            query: normalizedQuery,
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

      const message =
        error instanceof Error ? error.message : 'Search provider request failed.';

      this.logger.error(`[${provider}] Search failed: ${message}`);

      throw new InternalServerErrorException(message);
    }
  }

  private async searchWithTavily(query: string): Promise<TavilySearchResponse> {
    const tavilyClient = this.getTavilyClient();

    if (!tavilyClient) {
      throw new ServiceUnavailableException(
        'TAVILY_API_KEY is not configured.',
      );
    }

    return tavilyClient.search(query, {
      searchDepth: 'basic',
      maxResults: 5,
      includeAnswer: 'basic',
      includeRawContent: false,
    });
  }

  private async searchWithExa(query: string): Promise<ExaTextSearchResponse> {
    const exaClient = this.getExaClient();

    return exaClient.search(query, {
      numResults: 5,
      type: 'auto',
      contents: {
        text: {
          maxCharacters: 1200,
        },
      },
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
      snippet: result.content,
      score: result.score,
      publishedAt: result.publishedDate || null,
    }));
  }

  private normalizeExaResults(
    raw: ExaTextSearchResponse,
  ): NormalizedSearchResult[] {
    return raw.results.map((result) => ({
      title: result.title ?? result.url,
      url: result.url,
      snippet: result.text ?? '',
      score: result.score ?? null,
      publishedAt: result.publishedDate ?? null,
    }));
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

  private formatQueryForLog(query: string): string {
    return query.length > 180 ? `${query.slice(0, 177)}...` : query;
  }
}
