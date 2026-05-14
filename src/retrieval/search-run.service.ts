import { Injectable, Logger } from '@nestjs/common';
import { cleanContent } from '../search/content-cleaner';
import { SearchService } from '../search/search.service';
import type {
  SearchRunResponseData,
  SearchRunResult,
  ValidatedSearchRunRequest,
} from './search-run.types';

const HIGHLIGHT_MAX_CHARS = 1200;

@Injectable()
export class SearchRunService {
  private readonly logger = new Logger(SearchRunService.name);

  constructor(private readonly searchService: SearchService) {}

  async run(
    request: ValidatedSearchRunRequest,
    correlationId: string,
  ): Promise<SearchRunResponseData> {
    const startedAt = Date.now();
    const { queryText, extractLimit } = request.query;

    this.logger.log(
      `[${correlationId}] search.run start query="${this.formatForLog(queryText)}" extractLimit=${extractLimit}`,
    );

    const inspection = await this.searchService.searchThenExtract(
      queryText,
      Math.max(extractLimit, 5),
      extractLimit,
    );

    const durationMs = Date.now() - startedAt;

    if (inspection.status !== 'ok' || !inspection.extract) {
      const errorMessage = inspection.error ?? 'search.run failed';
      this.logger.warn(
        `[${correlationId}] search.run failed after ${durationMs}ms: ${errorMessage}`,
      );
      throw new Error(errorMessage);
    }

    const results: SearchRunResult[] = inspection.extract.documents.map(
      (document) => ({
        url: document.url,
        title: document.title,
        highlight: this.normalizeHighlight(document.excerpt),
        publishedAt: document.publishedAt,
        relevanceScore: document.score,
      }),
    );

    const providerRequestId =
      inspection.extract.requestId ?? inspection.search?.requestId ?? null;

    this.logger.log(
      `[${correlationId}] search.run completed in ${durationMs}ms with ${results.length} result(s)`,
    );

    return {
      queryText,
      results,
      diagnostics: {
        extractLimit,
        resultCount: results.length,
        durationMs,
        providerRequestId,
      },
    };
  }

  private normalizeHighlight(raw: string): string {
    const cleaned = cleanContent(raw ?? '');
    if (!cleaned) return '';
    if (cleaned.length <= HIGHLIGHT_MAX_CHARS) return cleaned;
    return `${cleaned.slice(0, HIGHLIGHT_MAX_CHARS - 3).trimEnd()}...`;
  }

  private formatForLog(value: string): string {
    return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  }
}

