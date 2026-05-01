import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createUuidV7 } from '../common/ids';
import { serviceRuntimeConfig } from '../config/service-config';
import { SearchService } from '../search/search.service';
import type { ExtractedDocument } from '../search/search.types';
import {
  resolveSearchQuery,
  type SearchQueryResolution,
} from '../search/search-query-resolver';
import { KnowledgeStoreService } from './knowledge-store.service';
import { RetrievalPolicyService } from './retrieval-policy.service';
import {
  validateRetrieveEvidenceRequest,
  assertCorrelationId,
} from './retrieval-validation';
import type {
  EvidenceChunk,
  EvidenceSynthesis,
  ImageInputPart,
  Modality,
  NormalizedQuery,
  RetrieveEvidenceData,
  RetrievalFreshness,
  RetrievalMode,
  ValidatedRetrieveEvidenceRequest,
} from './retrieval.types';

interface LiveRetrievalResult {
  chunks: EvidenceChunk[];
  error: string | null;
  warnings: string[];
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly searchService: SearchService,
    private readonly knowledgeStore: KnowledgeStoreService,
    private readonly retrievalPolicy: RetrievalPolicyService,
  ) {}

  async retrieveEvidence(
    rawRequest: unknown,
    correlationId: string | undefined,
  ): Promise<RetrieveEvidenceData> {
    assertCorrelationId(correlationId);

    const startedAt = Date.now();
    const request = validateRetrieveEvidenceRequest(
      rawRequest,
      this.getConfiguredInteger(
        'RAG_MAX_EVIDENCE_CHUNKS',
        serviceRuntimeConfig.maxEvidenceChunks,
      ),
    );
    const queryText = this.buildQueryText(request);
    const hasSearchableText = queryText.length > 0;
    const queryResolution = hasSearchableText
      ? resolveSearchQuery(queryText)
      : null;
    const effectiveQuery = queryResolution?.effectiveQuery ?? queryText;
    const imageParts = this.getImageParts(request);
    const imageObservations = this.buildImageObservations(imageParts);
    const modality = this.detectModality(request);
    const intent =
      request.query.intent?.trim() ||
      queryResolution?.executionHints.intent ||
      (imageParts.length > 0 ? 'image-supported-retrieval' : 'general');
    const shouldProbeLocal =
      hasSearchableText && request.query.allowedModes.includes('local_rag');
    const localResults = shouldProbeLocal
      ? await this.knowledgeStore.search(
          effectiveQuery,
          request.query.freshness,
          request.query.maxEvidenceChunks * 2,
        )
      : [];
    const policyDecision = this.retrievalPolicy.decide({
      allowedModes: request.query.allowedModes,
      freshness: request.query.freshness,
      localResultCount: localResults.length,
      hasSearchableText,
      hasImageInput: imageParts.length > 0,
    });
    const caveats: string[] = [];
    const localChunks = policyDecision.useLocal
      ? localResults.map((result) => this.mapLocalResultToEvidence(result))
      : [];
    const liveResult = policyDecision.useLive
      ? await this.performLiveRetrieval(
          effectiveQuery,
          intent,
          request,
          queryResolution,
        )
      : { chunks: [], error: null, warnings: [] };

    if (liveResult.error) {
      caveats.push(liveResult.error);
    }

    caveats.push(...liveResult.warnings);

    if (imageParts.length > 0) {
      caveats.push(
        'Image interpretation is reference-level only in phase one until a Utility LLM Host is configured.',
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
    const normalizedQuery: NormalizedQuery = {
      modality,
      intent,
      queryText: effectiveQuery,
      imageObservations,
      retrievalMode: policyDecision.mode,
      freshness: request.query.freshness,
      reason: policyDecision.reason,
    };
    const synthesis = this.buildSynthesis(
      request.query.synthesisMode,
      evidenceChunks,
      caveats,
      policyDecision.mode,
    );

    this.logger.log(
      `[retrieval] ${policyDecision.mode} produced ${evidenceChunks.length} evidence chunk(s) for correlation ${correlationId}.`,
    );

    return {
      normalizedQuery,
      searchQueries: this.buildSearchQueries(queryText, effectiveQuery),
      evidenceChunks,
      ...(synthesis ? { evidenceSynthesis: synthesis } : {}),
      retrievalDiagnostics: {
        liveSearchPerformed: policyDecision.useLive,
        localSearchPerformed: shouldProbeLocal,
        durationMs: Date.now() - startedAt,
        localResultCount: localResults.length,
        liveResultCount: liveResult.chunks.length,
        ...(liveResult.error ? { liveSearchError: liveResult.error } : {}),
        ...(liveResult.warnings.length > 0
          ? { warnings: liveResult.warnings }
          : {}),
        knowledgeStorePath: this.knowledgeStore.storePath,
      },
    };
  }

  private async performLiveRetrieval(
    effectiveQuery: string,
    intent: string,
    request: ValidatedRetrieveEvidenceRequest,
    queryResolution: SearchQueryResolution | null,
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
    );

    if (inspection.status !== 'ok') {
      return {
        chunks: [],
        error: inspection.error
          ? `Live web retrieval failed: ${inspection.error}`
          : 'Live web retrieval failed.',
        warnings: [],
      };
    }

    const documents = inspection.extract?.documents ?? [];

    const warnings: string[] = [];

    try {
      await this.knowledgeStore.upsertExtractedDocuments(
        documents,
        queryResolution?.effectiveQuery ?? effectiveQuery,
        intent,
        retrievedAt,
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
        ),
      ),
      error: null,
      warnings,
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

    return {
      evidenceId: createUuidV7(),
      sourceType: 'web',
      sourceTitle: document.title || document.url,
      sourceUrl: document.url,
      content: this.limitEvidenceContent(document.excerpt || document.content),
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
        ? `Image URL received for retrieval support: ${part.imageUrl}. Utility-model visual interpretation is not configured in this phase.`
        : `Image ID received for retrieval support: ${part.imageId}. Utility-model visual interpretation is not configured in this phase.`,
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
    queryText: string,
    effectiveQuery: string,
  ): string[] {
    return [...new Set([effectiveQuery, queryText].filter(Boolean))];
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
