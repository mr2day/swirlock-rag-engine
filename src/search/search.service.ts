import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { tavily, type TavilySearchResponse } from '@tavily/core';
import { search as searchDuckDuckGo, type SearchResults } from 'duck-duck-scrape';
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
  private exaClient: Exa | null = null;

  private tavilyClient = process.env.TAVILY_API_KEY
    ? tavily({ apiKey: process.env.TAVILY_API_KEY })
    : null;

  async search(
    query: string,
    provider: SearchProvider,
  ): Promise<SearchExecutionResult> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      throw new BadRequestException('Query must not be empty.');
    }

    const startedAt = Date.now();

    try {
      switch (provider) {
        case 'tavily': {
          const raw = await this.searchWithTavily(normalizedQuery);

          return {
            provider,
            query: normalizedQuery,
            latencyMs: Date.now() - startedAt,
            normalized: this.normalizeTavilyResults(raw),
            raw,
          };
        }

        case 'exa': {
          const raw = await this.searchWithExa(normalizedQuery);

          return {
            provider,
            query: normalizedQuery,
            latencyMs: Date.now() - startedAt,
            normalized: this.normalizeExaResults(raw),
            raw,
          };
        }

        case 'ddg':
        default: {
          const raw = await this.searchWithDuckDuckGo(normalizedQuery);

          return {
            provider: 'ddg',
            query: normalizedQuery,
            latencyMs: Date.now() - startedAt,
            normalized: this.normalizeDuckDuckGoResults(raw),
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

      throw new InternalServerErrorException(message);
    }
  }

  private async searchWithDuckDuckGo(query: string): Promise<SearchResults> {
    return searchDuckDuckGo(query);
  }

  private async searchWithTavily(query: string): Promise<TavilySearchResponse> {
    if (!this.tavilyClient) {
      throw new ServiceUnavailableException(
        'TAVILY_API_KEY is not configured.',
      );
    }

    return this.tavilyClient.search(query, {
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

    const apiKey = process.env.EXA_API_KEY;

    if (!apiKey) {
      throw new ServiceUnavailableException('EXA_API_KEY is not configured.');
    }

    this.exaClient = new Exa(apiKey);

    return this.exaClient;
  }

  private normalizeDuckDuckGoResults(
    raw: SearchResults,
  ): NormalizedSearchResult[] {
    return raw.results.map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.description,
      score: null,
      publishedAt: null,
    }));
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
}
