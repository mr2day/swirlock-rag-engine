import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createUuidV7 } from '../common/ids';
import { serviceRuntimeConfig } from '../config/service-config';
import { SearchService } from '../search/search.service';
import type {
  ExtractedDocument,
  NormalizedSearchResult,
  SearchExtractProgressHandler,
} from '../search/search.types';
import { EmbeddingServiceService } from './embedding-service.service';
import { KnowledgeStoreService } from './knowledge-store.service';
import { RetrievalPolicyService } from './retrieval-policy.service';
import {
  validateRetrieveEvidenceRequest,
  assertCorrelationId,
} from './retrieval-validation';
import type {
  EvidenceChunk,
  NormalizedQuery,
  RetrieveEvidenceData,
  RetrievalFreshness,
  RetrievalStreamEmitter,
  RetrievalStreamEventType,
  ValidatedRetrieveEvidenceRequest,
} from './retrieval.types';
import type { EmbeddingCallDiagnostics } from './embedding-service.types';

interface LiveRetrievalResult {
  chunks: EvidenceChunk[];
  error: string | null;
  warnings: string[];
}

interface EmbeddingRetrievalState {
  enabled: boolean;
  configuredUrl: string;
  modelId: string;
  dimensions: number;
  usedForQuery: boolean;
  calls: EmbeddingCallDiagnostics[];
}

type RetrievalProgressPublisher = (
  type: RetrievalStreamEventType,
  data?: Record<string, unknown>,
) => Promise<void>;

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly searchService: SearchService,
    private readonly knowledgeStore: KnowledgeStoreService,
    private readonly retrievalPolicy: RetrievalPolicyService,
    private readonly embeddingService: EmbeddingServiceService,
  ) {}

  async retrieveEvidence(
    rawRequest: unknown,
    correlationId: string | undefined,
    streamEmitter?: RetrievalStreamEmitter,
  ): Promise<RetrieveEvidenceData> {
    assertCorrelationId(correlationId);

    let streamSequence = 0;
    const publish: RetrievalProgressPublisher = async (type, data = {}) => {
      if (!streamEmitter) {
        return;
      }

      streamSequence += 1;
      await streamEmitter({
        type,
        sequence: streamSequence,
        occurredAt: new Date().toISOString(),
        data,
      });
    };
    const startedAt = Date.now();
    const request = validateRetrieveEvidenceRequest(
      rawRequest,
      this.getConfiguredInteger(
        'RAG_MAX_EVIDENCE_CHUNKS',
        serviceRuntimeConfig.maxEvidenceChunks,
      ),
    );
    await publish('retrieval.started', {
      freshness: request.query.freshness,
      allowedModes: request.query.allowedModes,
      maxEvidenceChunks: request.query.maxEvidenceChunks,
      partTypes: request.query.parts.map((part) => part.type),
    });

    const effectiveQuery = this.buildQueryText(request);
    const embeddingConfig = this.embeddingService.getConfiguration();
    const embeddingState: EmbeddingRetrievalState = {
      enabled: embeddingConfig.enabled,
      configuredUrl: embeddingConfig.url,
      modelId: embeddingConfig.modelId,
      dimensions: embeddingConfig.dimensions,
      usedForQuery: false,
      calls: [],
    };

    const hasSearchableText = effectiveQuery.length > 0;
    const intent = request.query.intent?.trim() || 'general';
    const shouldProbeLocal =
      hasSearchableText && request.query.allowedModes.includes('local_rag');
    const caveats: string[] = [];
    let queryEmbedding: number[] | null = null;
    await publish('query.normalized', {
      queryText: effectiveQuery,
      intent,
      modality: 'text',
      hasSearchableText,
    });

    if (shouldProbeLocal && embeddingState.enabled) {
      await publish('embedding.query.started', {
        modelId: embeddingState.modelId,
        dimensions: embeddingState.dimensions,
      });
      const { result, diagnostics } = await this.embeddingService.embed(
        correlationId,
        [effectiveQuery],
        'query',
      );

      embeddingState.calls.push(diagnostics);

      if (diagnostics.succeeded && result.embeddings[0]) {
        queryEmbedding = result.embeddings[0];
        embeddingState.usedForQuery = true;
      } else if (diagnostics.attempted && diagnostics.error) {
        caveats.push(
          `Embedding query generation failed; local retrieval used lexical search only: ${diagnostics.error}`,
        );
      }
      await publish('embedding.query.completed', {
        succeeded: diagnostics.succeeded,
        attempted: diagnostics.attempted,
        attempts: diagnostics.attempts,
        durationMs: diagnostics.durationMs,
        dimensions: result.dimensions,
        vectorCount: result.embeddings.length,
        usedForQuery: embeddingState.usedForQuery,
        ...(diagnostics.error ? { error: diagnostics.error } : {}),
      });
    }

    if (shouldProbeLocal) {
      await publish('local.search.started', {
        queryText: effectiveQuery,
        mode: queryEmbedding ? 'hybrid' : 'lexical',
        maxResults: request.query.maxEvidenceChunks * 2,
      });
    }
    const localResults = shouldProbeLocal
      ? queryEmbedding
        ? await this.knowledgeStore.searchHybrid(
            effectiveQuery,
            queryEmbedding,
            request.query.freshness,
            request.query.maxEvidenceChunks * 2,
          )
        : await this.knowledgeStore.search(
            effectiveQuery,
            request.query.freshness,
            request.query.maxEvidenceChunks * 2,
          )
      : [];
    if (shouldProbeLocal) {
      await publish('local.search.completed', {
        resultCount: localResults.length,
        mode: queryEmbedding ? 'hybrid' : 'lexical',
        sources: localResults.map((result) =>
          this.mapLocalResultToStreamSource(result),
        ),
      });
    }
    const policyDecision = this.retrievalPolicy.decide({
      allowedModes: request.query.allowedModes,
      freshness: request.query.freshness,
      localResultCount: localResults.length,
      hasSearchableText,
      hasImageInput: false,
    });
    await publish('retrieval.policy.decided', {
      mode: policyDecision.mode,
      reason: policyDecision.reason,
      useLocal: policyDecision.useLocal,
      useLive: policyDecision.useLive,
      localResultCount: localResults.length,
    });
    const localChunks = policyDecision.useLocal
      ? localResults.map((result) => this.mapLocalResultToEvidence(result))
      : [];
    const liveResult: LiveRetrievalResult = policyDecision.useLive
      ? await this.performLiveRetrieval(
          effectiveQuery,
          request,
          correlationId,
          publish,
        )
      : {
          chunks: [],
          error: null,
          warnings: [],
        };

    if (liveResult.error) {
      caveats.push(liveResult.error);
    }

    caveats.push(...liveResult.warnings);

    const evidenceChunks = this.limitEvidenceChunks(
      this.rankEvidenceChunks(
        this.dedupeEvidenceChunks([...liveResult.chunks, ...localChunks]),
      ),
      request.query.maxEvidenceChunks,
    );
    for (const chunk of evidenceChunks) {
      await publish('evidence.chunk', {
        chunk: this.mapEvidenceChunkToStreamSource(chunk),
      });
    }
    const normalizedQuery: NormalizedQuery = {
      modality: 'text',
      intent,
      queryText: effectiveQuery,
      retrievalMode: policyDecision.mode,
      freshness: request.query.freshness,
      reason: policyDecision.reason,
    };

    const retrievalDiagnostics = {
      liveSearchPerformed: policyDecision.useLive,
      localSearchPerformed: shouldProbeLocal,
      durationMs: Date.now() - startedAt,
      localResultCount: localResults.length,
      liveResultCount: liveResult.chunks.length,
      ...(liveResult.error ? { liveSearchError: liveResult.error } : {}),
      ...(caveats.length > 0 ? { warnings: caveats } : {}),
      embeddingService: embeddingState,
      knowledgeStorePath: this.knowledgeStore.storePath,
      knowledgeStoreKind: this.knowledgeStore.storeKind,
    };
    const data: RetrieveEvidenceData = {
      normalizedQuery,
      searchQueries: [effectiveQuery].filter(Boolean),
      evidenceChunks,
      retrievalDiagnostics,
    };

    try {
      await this.knowledgeStore.recordRetrievalRun({
        correlationId,
        queryText: effectiveQuery,
        intent,
        retrievalMode: policyDecision.mode,
        durationMs: retrievalDiagnostics.durationMs,
        localResultCount: localResults.length,
        liveResultCount: liveResult.chunks.length,
        evidenceChunkIds: evidenceChunks.map((chunk) => chunk.evidenceId),
        diagnostics: retrievalDiagnostics,
        retrievedAt: new Date().toISOString(),
      });
    } catch (error) {
      this.logger.warn(
        `[retrieval] Retrieval run metadata was not persisted: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    this.logger.log(
      `[retrieval] ${policyDecision.mode} produced ${evidenceChunks.length} evidence chunk(s) for correlation ${correlationId}.`,
    );

    await publish('retrieval.completed', {
      retrieval: data,
      durationMs: retrievalDiagnostics.durationMs,
      evidenceChunkCount: evidenceChunks.length,
    });

    return data;
  }

  private async performLiveRetrieval(
    effectiveQuery: string,
    request: ValidatedRetrieveEvidenceRequest,
    correlationId: string,
    publish: RetrievalProgressPublisher,
  ): Promise<LiveRetrievalResult> {
    const retrievedAt = new Date().toISOString();
    const searchLimit = this.getConfiguredInteger(
      'RAG_LIVE_SEARCH_LIMIT',
      serviceRuntimeConfig.liveSearchLimit,
    );
    const extractLimit = Math.min(
      this.getConfiguredInteger(
        'RAG_LIVE_EXTRACT_LIMIT',
        serviceRuntimeConfig.liveExtractLimit,
      ),
      request.query.maxEvidenceChunks,
    );
    const exaProgress = this.buildLiveProgressHandler(publish, 'exa');

    let exaInspection: Awaited<
      ReturnType<typeof this.searchService.searchThenExtract>
    > | null = null;
    let exaError: string | null = null;
    try {
      exaInspection = await this.searchService.searchThenExtract(
        effectiveQuery,
        searchLimit,
        extractLimit,
        exaProgress,
      );
      if (exaInspection.status !== 'ok') {
        exaError = exaInspection.error
          ? `Exa live retrieval failed: ${exaInspection.error}`
          : 'Exa live retrieval failed.';
      }
    } catch (error) {
      exaError = `Exa live retrieval failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }

    const documents = exaInspection?.extract?.documents ?? [];

    if (documents.length === 0) {
      return {
        chunks: [],
        error: exaError,
        warnings: [],
      };
    }

    return {
      chunks: documents.map((document, index) =>
        this.mapLiveDocumentToEvidence(
          document,
          request.query.freshness,
          retrievedAt,
          index,
          documents.length,
        ),
      ),
      error: exaError,
      warnings: [],
    };
  }

  private buildLiveProgressHandler(
    publish: RetrievalProgressPublisher,
    provider: 'exa',
  ): SearchExtractProgressHandler {
    return async (event) => {
      if (event.type === 'search_started') {
        await publish('live.search.started', {
          provider,
          queryText: event.query,
          searchLimit: event.searchLimit,
        });
      } else if (event.type === 'search_completed') {
        await publish('live.search.completed', {
          provider,
          queryText: event.query,
          latencyMs: event.search.latencyMs,
          resultCount: event.search.resultCount,
          requestId: event.search.requestId,
          sources: event.search.topResults.map((result) =>
            this.mapSearchResultToStreamSource(result),
          ),
        });
      } else if (event.type === 'extract_started') {
        await publish('live.extract.started', {
          provider,
          queryText: event.query,
          urls: event.urls,
          extractLimit: event.extractLimit,
        });
      } else if (event.type === 'extract_completed') {
        await publish('live.extract.completed', {
          provider,
          queryText: event.query,
          latencyMs: event.extract.latencyMs,
          documentCount: event.extract.documentCount,
          totalCharacters: event.extract.totalCharacters,
          failedSources: event.extract.failedSources,
          sources: event.extract.documents.map((document) =>
            this.mapExtractedDocumentToStreamSource(document),
          ),
        });
      }
    };
  }

  private mapLocalResultToEvidence(result: {
    document: {
      evidenceId: string;
      sourceTitle: string;
      sourceUrl: string | null;
      excerpt: string;
      content: string;
      publishedAt: string | null;
      lastRetrievedAt: string;
    };
    relevanceScore: number;
    freshnessScore: number;
  }): EvidenceChunk {
    const publishedAt = this.normalizeOptionalTimestamp(
      result.document.publishedAt,
    );

    return {
      evidenceId: result.document.evidenceId,
      sourceType: 'local_cache',
      sourceTitle: result.document.sourceTitle,
      ...(result.document.sourceUrl
        ? { sourceUrl: result.document.sourceUrl }
        : {}),
      content: this.limitEvidenceContent(
        result.document.excerpt || result.document.content,
      ),
      relevanceScore: result.relevanceScore,
      freshnessScore: result.freshnessScore,
      ...(publishedAt ? { publishedAt } : {}),
      retrievedAt: this.normalizeRequiredTimestamp(
        result.document.lastRetrievedAt,
      ),
    };
  }

  private mapLocalResultToStreamSource(result: {
    document: {
      evidenceId: string;
      sourceTitle: string;
      sourceUrl: string | null;
      publishedAt: string | null;
      lastRetrievedAt: string;
    };
    relevanceScore: number;
    freshnessScore: number;
    score: number;
  }): Record<string, unknown> {
    return {
      sourceType: 'local_cache',
      evidenceId: result.document.evidenceId,
      title: result.document.sourceTitle,
      ...(result.document.sourceUrl ? { url: result.document.sourceUrl } : {}),
      relevanceScore: result.relevanceScore,
      freshnessScore: result.freshnessScore,
      score: result.score,
      ...(result.document.publishedAt
        ? { publishedAt: result.document.publishedAt }
        : {}),
      retrievedAt: result.document.lastRetrievedAt,
    };
  }

  private mapSearchResultToStreamSource(
    result: NormalizedSearchResult,
  ): Record<string, unknown> {
    return {
      sourceType: 'web',
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      ...(result.score !== null ? { score: result.score } : {}),
      ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
    };
  }

  private mapExtractedDocumentToStreamSource(
    document: ExtractedDocument,
  ): Record<string, unknown> {
    return {
      sourceType: 'web',
      title: document.title,
      url: document.url,
      excerpt: this.limitEvidenceContent(document.excerpt, 500),
      contentLength: document.contentLength,
      ...(document.score !== null ? { score: document.score } : {}),
      ...(document.publishedAt ? { publishedAt: document.publishedAt } : {}),
    };
  }

  private mapEvidenceChunkToStreamSource(
    chunk: EvidenceChunk,
  ): Record<string, unknown> {
    return {
      evidenceId: chunk.evidenceId,
      sourceType: chunk.sourceType,
      title: chunk.sourceTitle,
      ...(chunk.sourceUrl ? { url: chunk.sourceUrl } : {}),
      content: this.limitEvidenceContent(chunk.content, 700),
      relevanceScore: chunk.relevanceScore,
      ...(chunk.freshnessScore !== undefined
        ? { freshnessScore: chunk.freshnessScore }
        : {}),
      ...(chunk.publishedAt ? { publishedAt: chunk.publishedAt } : {}),
      retrievedAt: chunk.retrievedAt,
    };
  }

  private mapLiveDocumentToEvidence(
    document: ExtractedDocument,
    freshness: RetrievalFreshness,
    retrievedAt: string,
    index: number,
    totalDocuments: number,
  ): EvidenceChunk {
    const publishedAt = this.normalizeOptionalTimestamp(document.publishedAt);
    const fallbackScore =
      totalDocuments > 0 ? 0.75 - index / (totalDocuments + 4) : 0.65;

    // The full Exa-extracted body text (up to text.maxCharacters,
    // currently 24000) lands on `content` uncapped. The answer model
    // reads this verbatim — no second-LLM distillation pass between
    // retrieval and answer.
    return {
      evidenceId: createUuidV7(),
      sourceType: 'web',
      sourceTitle: document.title || document.url,
      sourceUrl: document.url,
      content: (document.content || document.excerpt || '').trim(),
      relevanceScore: this.roundScore(document.score ?? fallbackScore),
      freshnessScore: this.scoreFreshness(
        publishedAt ?? retrievedAt,
        freshness,
      ),
      ...(publishedAt ? { publishedAt } : {}),
      retrievedAt,
    };
  }

  private buildQueryText(request: ValidatedRetrieveEvidenceRequest): string {
    const resolvedQueryText = request.query.resolvedQueryText?.trim();
    const textParts = request.query.parts
      .filter(
        (part): part is { type: 'text'; text: string } => part.type === 'text',
      )
      .map((part) => part.text.trim())
      .filter(Boolean);
    const hintText = request.query.hints.map((hint) => hint.text);

    return [resolvedQueryText || textParts.join(' '), ...hintText]
      .filter((segment) => segment.trim().length > 0)
      .join(' ')
      .trim();
  }

  private dedupeEvidenceChunks(chunks: EvidenceChunk[]): EvidenceChunk[] {
    const byKey = new Map<string, EvidenceChunk>();

    for (const chunk of chunks) {
      const key =
        chunk.sourceUrl?.toLowerCase() ??
        `${chunk.sourceTitle.toLowerCase()}:${chunk.content.slice(0, 80)}`;
      const existing = byKey.get(key);

      if (!existing || this.prefersChunk(chunk, existing)) {
        byKey.set(key, chunk);
      }
    }

    return [...byKey.values()];
  }

  private prefersChunk(
    candidate: EvidenceChunk,
    existing: EvidenceChunk,
  ): boolean {
    if (candidate.sourceType === 'web' && existing.sourceType !== 'web') {
      return true;
    }

    return candidate.relevanceScore > existing.relevanceScore;
  }

  private rankEvidenceChunks(chunks: EvidenceChunk[]): EvidenceChunk[] {
    return chunks.sort((left, right) => {
      const leftScore =
        left.relevanceScore * 0.8 + (left.freshnessScore ?? 0) * 0.2;
      const rightScore =
        right.relevanceScore * 0.8 + (right.freshnessScore ?? 0) * 0.2;

      return rightScore - leftScore;
    });
  }

  private limitEvidenceChunks(
    chunks: EvidenceChunk[],
    maxEvidenceChunks: number,
  ): EvidenceChunk[] {
    return chunks.slice(0, maxEvidenceChunks);
  }

  private normalizeOptionalTimestamp(
    value: string | null | undefined,
  ): string | null {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString();
  }

  private normalizeRequiredTimestamp(value: string | null | undefined): string {
    return this.normalizeOptionalTimestamp(value) ?? new Date().toISOString();
  }

  private scoreFreshness(
    timestamp: string,
    freshness: RetrievalFreshness,
  ): number {
    const ageDays =
      (Date.now() - Date.parse(timestamp)) / (1000 * 60 * 60 * 24);

    if (!Number.isFinite(ageDays) || ageDays < 0) {
      return 1;
    }

    const halfLifeDays =
      freshness === 'realtime'
        ? 1
        : freshness === 'high'
          ? 7
          : freshness === 'medium'
            ? 45
            : 365;

    return this.roundScore(Math.exp(-ageDays / halfLifeDays));
  }

  private limitEvidenceContent(value: string, maxLength = 1400): string {
    const normalized = value.replace(/\s+/g, ' ').trim();

    if (normalized.length <= maxLength) {
      return normalized || 'No extracted content returned.';
    }

    return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
  }

  private getConfiguredInteger(key: string, fallback: number): number {
    const value = Number.parseInt(
      this.configService.get<string>(key) ?? String(fallback),
      10,
    );

    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  private roundScore(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }
}
