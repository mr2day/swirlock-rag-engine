import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createUuidV7 } from '../common/ids';
import { serviceRuntimeConfig } from '../config/service-config';
import { SearchService } from '../search/search.service';
import type {
  ExtractedDocument,
  NormalizedSearchResult,
} from '../search/search.types';
import {
  resolveSearchQuery,
  type SearchQueryResolution,
} from '../search/search-query-resolver';
import { EmbeddingServiceService } from './embedding-service.service';
import { KnowledgeStoreService } from './knowledge-store.service';
import { RetrievalPolicyService } from './retrieval-policy.service';
import {
  validateRetrieveEvidenceRequest,
  assertCorrelationId,
} from './retrieval-validation';
import { UtilityLlmService } from './utility-llm.service';
import type {
  EvidenceChunk,
  EvidenceSynthesis,
  ImageInputPart,
  Modality,
  NormalizedQuery,
  RetrieveEvidenceData,
  RetrievalFreshness,
  RetrievalMode,
  RetrievalStreamEmitter,
  RetrievalStreamEventType,
  ValidatedRetrieveEvidenceRequest,
} from './retrieval.types';
import type { EmbeddingCallDiagnostics } from './embedding-service.types';
import type { UtilityLlmCallDiagnostics } from './utility-llm.types';

interface LiveRetrievalResult {
  chunks: EvidenceChunk[];
  error: string | null;
  warnings: string[];
  utilityDiagnostics: UtilityLlmCallDiagnostics[];
  usedExtractionSummaries: boolean;
}

interface UtilityLlmRetrievalState {
  enabled: boolean;
  configuredUrl: string;
  usedForQuery: boolean;
  usedForImages: boolean;
  usedForExtractionSummaries: boolean;
  usedForEvidenceSynthesis: boolean;
  calls: UtilityLlmCallDiagnostics[];
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
    private readonly utilityLlmService: UtilityLlmService,
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
      synthesisMode: request.query.synthesisMode,
      partTypes: request.query.parts.map((part) => part.type),
    });

    const initialQueryText = this.buildQueryText(request);
    const imageParts = this.getImageParts(request);
    const utilityConfig = this.utilityLlmService.getConfiguration();
    const utilityState: UtilityLlmRetrievalState = {
      enabled: utilityConfig.enabled,
      configuredUrl: utilityConfig.configuredUrl,
      usedForQuery: false,
      usedForImages: false,
      usedForExtractionSummaries: false,
      usedForEvidenceSynthesis: false,
      calls: [],
    };
    const embeddingConfig = this.embeddingService.getConfiguration();
    const embeddingState: EmbeddingRetrievalState = {
      enabled: embeddingConfig.enabled,
      configuredUrl: embeddingConfig.url,
      modelId: embeddingConfig.modelId,
      dimensions: embeddingConfig.dimensions,
      usedForQuery: false,
      calls: [],
    };
    await publish('utility_llm.retrieval_support.started', {
      enabled: utilityState.enabled,
      configuredUrl: utilityState.configuredUrl,
    });
    const utilitySupport = await this.utilityLlmService.prepareRetrievalSupport(
      {
        correlationId,
        queryText: initialQueryText,
        freshness: request.query.freshness,
        allowedModes: request.query.allowedModes,
        intent: request.query.intent,
        hints: request.query.hints,
        imageParts,
      },
    );

    utilityState.usedForQuery = utilitySupport.usedForQuery;
    utilityState.usedForImages = utilitySupport.usedForImages;
    utilityState.calls.push(...utilitySupport.diagnostics);
    await publish('utility_llm.retrieval_support.completed', {
      usedForQuery: utilitySupport.usedForQuery,
      usedForImages: utilitySupport.usedForImages,
      searchQueries: utilitySupport.searchQueries,
      imageObservationCount: utilitySupport.imageObservations.length,
      warningCount: utilitySupport.warnings.length,
      diagnostics: utilitySupport.diagnostics,
    });

    const queryText = (
      utilitySupport.queryText ||
      utilitySupport.searchQueries[0] ||
      initialQueryText
    ).trim();
    const hasSearchableText = queryText.length > 0;
    const queryResolution = hasSearchableText
      ? resolveSearchQuery(queryText)
      : null;
    const effectiveQuery = queryResolution?.effectiveQuery ?? queryText;
    const imageObservations =
      utilitySupport.imageObservations.length > 0
        ? utilitySupport.imageObservations
        : this.buildImageObservations(imageParts);
    const modality = this.detectModality(request);
    const intent =
      request.query.intent?.trim() ||
      utilitySupport.intent ||
      queryResolution?.executionHints.intent ||
      (imageParts.length > 0 ? 'image-supported-retrieval' : 'general');
    const shouldProbeLocal =
      hasSearchableText && request.query.allowedModes.includes('local_rag');
    const caveats: string[] = [];
    let queryEmbedding: number[] | null = null;
    await publish('query.normalized', {
      queryText: effectiveQuery,
      intent,
      modality,
      imageObservationCount: imageObservations.length,
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
      hasImageInput: imageParts.length > 0,
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
    const liveResult = policyDecision.useLive
      ? await this.performLiveRetrieval(
          effectiveQuery,
          intent,
          request,
          queryResolution,
          correlationId,
          publish,
        )
      : {
          chunks: [],
          error: null,
          warnings: [],
          utilityDiagnostics: [],
          usedExtractionSummaries: false,
        };

    if (liveResult.error) {
      caveats.push(liveResult.error);
    }

    caveats.push(...utilitySupport.warnings);
    caveats.push(...liveResult.warnings);
    utilityState.usedForExtractionSummaries =
      liveResult.usedExtractionSummaries;
    utilityState.calls.push(...liveResult.utilityDiagnostics);

    if (imageParts.length > 0 && !utilitySupport.usedForImages) {
      caveats.push(
        'Image interpretation is reference-level only because no Utility LLM image observations were available.',
      );
    }

    const evidenceChunks = this.limitEvidenceChunks(
      this.rankEvidenceChunks(
        this.dedupeEvidenceChunks([
          ...liveResult.chunks,
          ...localChunks,
          ...this.buildImageReferenceEvidence(imageParts, policyDecision.mode),
        ]),
      ),
      request.query.maxEvidenceChunks,
    );
    for (const chunk of evidenceChunks) {
      await publish('evidence.chunk', {
        chunk: this.mapEvidenceChunkToStreamSource(chunk),
      });
    }
    const normalizedQuery: NormalizedQuery = {
      modality,
      intent,
      queryText: effectiveQuery,
      imageObservations,
      retrievalMode: policyDecision.mode,
      freshness: request.query.freshness,
      reason: policyDecision.reason,
    };
    if (request.query.synthesisMode !== 'none') {
      await publish('utility_llm.evidence_synthesis.started', {
        synthesisMode: request.query.synthesisMode,
        evidenceChunkCount: evidenceChunks.length,
      });
    }
    const utilitySynthesis =
      request.query.synthesisMode !== 'none'
        ? await this.utilityLlmService.shapeEvidenceSynthesis({
            correlationId,
            queryText: effectiveQuery,
            synthesisMode: request.query.synthesisMode,
            evidenceChunks,
            caveats,
          })
        : {
            synthesis: null,
            warnings: [],
            diagnostics: [],
          };

    utilityState.usedForEvidenceSynthesis = Boolean(utilitySynthesis.synthesis);
    utilityState.calls.push(...utilitySynthesis.diagnostics);
    caveats.push(...utilitySynthesis.warnings);
    if (request.query.synthesisMode !== 'none') {
      await publish('utility_llm.evidence_synthesis.completed', {
        succeeded: Boolean(utilitySynthesis.synthesis),
        warningCount: utilitySynthesis.warnings.length,
        diagnostics: utilitySynthesis.diagnostics,
      });
    }

    const synthesis =
      utilitySynthesis.synthesis ??
      this.buildSynthesis(
        request.query.synthesisMode,
        evidenceChunks,
        caveats,
        policyDecision.mode,
      );

    const retrievalDiagnostics = {
      liveSearchPerformed: policyDecision.useLive,
      localSearchPerformed: shouldProbeLocal,
      durationMs: Date.now() - startedAt,
      localResultCount: localResults.length,
      liveResultCount: liveResult.chunks.length,
      ...(liveResult.error ? { liveSearchError: liveResult.error } : {}),
      ...(caveats.length > 0 ? { warnings: caveats } : {}),
      utilityLlm: utilityState,
      embeddingService: embeddingState,
      knowledgeStorePath: this.knowledgeStore.storePath,
      knowledgeStoreKind: this.knowledgeStore.storeKind,
    };
    const data: RetrieveEvidenceData = {
      normalizedQuery,
      searchQueries: this.buildSearchQueries(
        initialQueryText,
        queryText,
        effectiveQuery,
        utilitySupport.searchQueries,
      ),
      evidenceChunks,
      ...(synthesis ? { evidenceSynthesis: synthesis } : {}),
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
    intent: string,
    request: ValidatedRetrieveEvidenceRequest,
    queryResolution: SearchQueryResolution | null,
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
    const inspection = await this.searchService.searchThenExtract(
      effectiveQuery,
      searchLimit,
      extractLimit,
      async (event) => {
        if (event.type === 'search_started') {
          await publish('live.search.started', {
            queryText: event.query,
            searchLimit: event.searchLimit,
          });
        } else if (event.type === 'search_completed') {
          await publish('live.search.completed', {
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
            queryText: event.query,
            urls: event.urls,
            extractLimit: event.extractLimit,
          });
        } else if (event.type === 'extract_completed') {
          await publish('live.extract.completed', {
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
      },
    );

    if (inspection.status !== 'ok') {
      return {
        chunks: [],
        error: inspection.error
          ? `Live web retrieval failed: ${inspection.error}`
          : 'Live web retrieval failed.',
        warnings: [],
        utilityDiagnostics: [],
        usedExtractionSummaries: false,
      };
    }

    const documents = inspection.extract?.documents ?? [];
    const warnings: string[] = [];
    const utilityDiagnostics: UtilityLlmCallDiagnostics[] = [];
    await publish('utility_llm.extraction_summaries.started', {
      documentCount: documents.length,
    });
    const extractionSummaries =
      await this.utilityLlmService.summarizeExtractedDocuments({
        correlationId,
        queryText: effectiveQuery,
        intent,
        documents: documents.map((document) => ({
          title: document.title,
          url: document.url,
          excerpt: document.excerpt,
          content: document.content,
          publishedAt: document.publishedAt,
        })),
      });

    warnings.push(...extractionSummaries.warnings);
    utilityDiagnostics.push(...extractionSummaries.diagnostics);
    await publish('utility_llm.extraction_summaries.completed', {
      summaryCount: extractionSummaries.summariesByUrl.size,
      warningCount: extractionSummaries.warnings.length,
      diagnostics: extractionSummaries.diagnostics,
    });

    try {
      await this.knowledgeStore.upsertExtractedDocuments(
        documents,
        queryResolution?.effectiveQuery ?? effectiveQuery,
        intent,
        retrievedAt,
        request.query.freshness,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown persistence error.';

      this.logger.warn(
        `[retrieval] Live evidence was returned, but cache persistence failed: ${message}`,
      );
      warnings.push(
        `Knowledge-store cache persistence failed after live retrieval: ${message}`,
      );
    }

    return {
      chunks: documents.map((document, index) =>
        this.mapLiveDocumentToEvidence(
          document,
          request.query.freshness,
          retrievedAt,
          index,
          documents.length,
          extractionSummaries.summariesByUrl.get(document.url),
        ),
      ),
      error: null,
      warnings,
      utilityDiagnostics,
      usedExtractionSummaries: extractionSummaries.summariesByUrl.size > 0,
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
    utilitySummary?: string,
  ): EvidenceChunk {
    const publishedAt = this.normalizeOptionalTimestamp(document.publishedAt);
    const fallbackScore =
      totalDocuments > 0 ? 0.75 - index / (totalDocuments + 4) : 0.65;

    return {
      evidenceId: createUuidV7(),
      sourceType: 'web',
      sourceTitle: document.title || document.url,
      sourceUrl: document.url,
      content: this.limitEvidenceContent(
        utilitySummary || document.excerpt || document.content,
      ),
      relevanceScore: this.roundScore(document.score ?? fallbackScore),
      freshnessScore: this.scoreFreshness(
        publishedAt ?? retrievedAt,
        freshness,
      ),
      ...(publishedAt ? { publishedAt } : {}),
      retrievedAt,
    };
  }

  private buildImageReferenceEvidence(
    imageParts: ImageInputPart[],
    retrievalMode: RetrievalMode,
  ): EvidenceChunk[] {
    if (imageParts.length === 0) {
      return [];
    }

    const retrievedAt = new Date().toISOString();

    return imageParts.map((part, index) => ({
      evidenceId: createUuidV7(),
      sourceType: 'image_analysis',
      sourceTitle: `Image reference ${index + 1}`,
      ...(part.imageUrl ? { sourceUrl: part.imageUrl } : {}),
      content: part.imageUrl
        ? `Image URL received for retrieval support: ${part.imageUrl}. Utility LLM image observations are reported on normalizedQuery.imageObservations when available.`
        : `Image ID received for retrieval support: ${part.imageId}. Utility LLM image observations require a media resolver before RAG can fetch image bytes.`,
      relevanceScore: retrievalMode === 'none' ? 0.2 : 0.1,
      freshnessScore: 1,
      retrievedAt,
    }));
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

  private detectModality(request: ValidatedRetrieveEvidenceRequest): Modality {
    const hasText = request.query.parts.some((part) => part.type === 'text');
    const hasImage = request.query.parts.some((part) => part.type === 'image');

    if (hasText && hasImage) {
      return 'multimodal';
    }

    return hasImage ? 'image' : 'text';
  }

  private getImageParts(
    request: ValidatedRetrieveEvidenceRequest,
  ): ImageInputPart[] {
    return request.query.parts.filter(
      (part): part is ImageInputPart => part.type === 'image',
    );
  }

  private buildImageObservations(imageParts: ImageInputPart[]): string[] {
    return imageParts.map((part, index) =>
      part.imageUrl
        ? `Image ${index + 1} is referenced by URL: ${part.imageUrl}.`
        : `Image ${index + 1} is referenced by imageId: ${part.imageId}.`,
    );
  }

  private buildSearchQueries(
    initialQueryText: string,
    queryText: string,
    effectiveQuery: string,
    utilityQueries: string[],
  ): string[] {
    return [
      ...new Set(
        [effectiveQuery, queryText, ...utilityQueries, initialQueryText].filter(
          Boolean,
        ),
      ),
    ];
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

  private buildSynthesis(
    synthesisMode: 'none' | 'brief' | 'detailed',
    evidenceChunks: EvidenceChunk[],
    caveats: string[],
    retrievalMode: RetrievalMode,
  ): EvidenceSynthesis | null {
    if (synthesisMode === 'none') {
      return null;
    }

    if (evidenceChunks.length === 0) {
      return {
        summary: 'No evidence chunks were found for this retrieval request.',
        confidence: 'low',
        caveats: caveats.length > 0 ? caveats : ['No usable evidence found.'],
      };
    }

    const topSources = evidenceChunks
      .slice(0, synthesisMode === 'detailed' ? 4 : 2)
      .map((chunk) => `${chunk.sourceTitle}: ${chunk.content}`)
      .join(' ');
    const summary =
      synthesisMode === 'detailed'
        ? this.limitEvidenceContent(topSources, 1800)
        : this.limitEvidenceContent(
            `Top retrieval evidence came from ${evidenceChunks
              .slice(0, 2)
              .map((chunk) => chunk.sourceTitle)
              .join(' and ')}.`,
            700,
          );

    return {
      summary,
      confidence: this.estimateConfidence(evidenceChunks, retrievalMode),
      caveats,
    };
  }

  private estimateConfidence(
    evidenceChunks: EvidenceChunk[],
    retrievalMode: RetrievalMode,
  ): EvidenceSynthesis['confidence'] {
    const webEvidenceCount = evidenceChunks.filter(
      (chunk) => chunk.sourceType === 'web',
    ).length;
    const averageRelevance =
      evidenceChunks.reduce((total, chunk) => total + chunk.relevanceScore, 0) /
      evidenceChunks.length;

    if (
      evidenceChunks.length >= 3 &&
      averageRelevance >= 0.65 &&
      (webEvidenceCount > 0 || retrievalMode === 'local_rag')
    ) {
      return 'high';
    }

    if (evidenceChunks.length >= 1 && averageRelevance >= 0.35) {
      return 'medium';
    }

    return 'low';
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
