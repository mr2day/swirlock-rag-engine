import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { createUuidV7 } from '../common/ids';
import { serviceRuntimeConfig } from '../config/service-config';
import type { ExtractedDocument } from '../search/search.types';
import {
  canonicalizeUrl,
  chunkKnowledgeContent,
  computeRefreshPolicy,
  createStableDocumentId,
  getSourceDomain,
  hashText,
  scoreSourceQuality,
  selectDiverseResults,
  type KnowledgeChunk,
} from './knowledge-indexing';
import {
  KNOWLEDGE_STORE_MIGRATIONS,
  KNOWLEDGE_STORE_SCHEMA_VERSION,
} from './knowledge-store.schema';
import type { RetrievalFreshness, RetrievalMode } from './retrieval.types';

const STORE_SCHEMA_VERSION = 1;
const MAX_STORED_DOCUMENTS = 500;
const MAX_STORED_CONTENT_LENGTH = 12000;
const MAX_POSTGRES_CONTENT_LENGTH = 80000;
const SEARCH_CONTENT_WINDOW = 5000;
const DATABASE_STATEMENT_TIMEOUT_MS = 15000;
const POSTGRES_CANDIDATE_MULTIPLIER = 5;
const POSTGRES_MIN_CANDIDATES = 25;
const EMBEDDING_JOB_STALE_AFTER_MS = 15 * 60 * 1000;

export type KnowledgeStoreKind = 'postgresql' | 'json_file';

export interface KnowledgeStoreDocument {
  evidenceId: string;
  sourceTitle: string;
  sourceUrl: string | null;
  canonicalUrl?: string | null;
  sourceDomain?: string | null;
  content: string;
  excerpt: string;
  providerSummary: string | null;
  intent: string;
  searchQueries: string[];
  publishedAt: string | null;
  firstRetrievedAt: string;
  lastRetrievedAt: string;
  lastSeenAt: string;
  timesSeen: number;
  contentHash: string;
  chunkIndex?: number;
  sourceQualityScore?: number;
}

export interface KnowledgeStoreSearchResult {
  document: KnowledgeStoreDocument;
  relevanceScore: number;
  freshnessScore: number;
  score: number;
}

export interface KnowledgeStoreRetrievalRun {
  correlationId: string;
  queryText: string;
  intent: string;
  retrievalMode: RetrievalMode;
  durationMs: number;
  localResultCount: number;
  liveResultCount: number;
  evidenceChunkIds: string[];
  diagnostics: Record<string, unknown>;
  retrievedAt: string;
}

export interface EmbeddingJobClaim {
  jobId: string;
  chunkId: string;
  attempts: number;
  content: string;
}

export interface EmbeddingJobStats {
  configuredModel: string;
  configuredDimensions: number;
  pending: number;
  inProgress: number;
  done: number;
  failed: number;
  embeddedChunks: number;
  chunksAwaitingEmbedding: number;
}

interface EmbeddingJobClaimRow extends QueryResultRow {
  job_id: string;
  chunk_id: string;
  attempts: number;
  content: string;
}

export interface KnowledgeStoreStatus {
  kind: KnowledgeStoreKind;
  location: string;
  ready: boolean;
  documentCount: number;
  schemaVersion?: number;
  error?: string;
}

interface KnowledgeStoreFile {
  schemaVersion: number;
  updatedAt: string;
  documents: KnowledgeStoreDocument[];
}

interface ExistingDocumentRow extends QueryResultRow {
  id: string;
  search_queries: string[];
  times_seen: number;
}

interface ChunkRow extends QueryResultRow {
  evidence_id: string;
  chunk_index: number;
  source_title: string;
  source_url: string | null;
  canonical_url?: string | null;
  source_domain?: string | null;
  content: string;
  excerpt: string;
  provider_summary: string | null;
  intent: string;
  search_queries: string[];
  published_at: Date | string | null;
  first_retrieved_at: Date | string;
  last_retrieved_at: Date | string;
  last_seen_at: Date | string;
  times_seen: number;
  content_hash: string;
  lexical_rank?: number | string | null;
  trigram_rank?: number | string | null;
  source_quality_score?: number | string | null;
  exact_title?: boolean | null;
  exact_excerpt?: boolean | null;
  exact_content?: boolean | null;
  vector_similarity?: number | string | null;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, Math.max(0, maxLength - 3)) + '...';
}

@Injectable()
export class KnowledgeStoreService implements OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeStoreService.name);
  private store: KnowledgeStoreFile | null = null;
  private writeQueue = Promise.resolve();
  private pool: Pool | null = null;
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {}

  get storeKind(): KnowledgeStoreKind {
    return this.getDatabaseUrl() ? 'postgresql' : 'json_file';
  }

  get storePath(): string {
    const databaseUrl = this.getDatabaseUrl();

    if (databaseUrl) {
      return this.safeDatabaseLocation(databaseUrl);
    }

    return (
      this.configService.get<string>('RAG_KNOWLEDGE_STORE_PATH') ||
      serviceRuntimeConfig.knowledgeStorePath
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async getStatus(): Promise<KnowledgeStoreStatus> {
    try {
      const documentCount = await this.count();

      return {
        kind: this.storeKind,
        location: this.storePath,
        ready: true,
        documentCount,
        ...(this.storeKind === 'postgresql'
          ? { schemaVersion: KNOWLEDGE_STORE_SCHEMA_VERSION }
          : { schemaVersion: STORE_SCHEMA_VERSION }),
      };
    } catch (error) {
      return {
        kind: this.storeKind,
        location: this.storePath,
        ready: false,
        documentCount: 0,
        error: this.getErrorMessage(error),
      };
    }
  }

  async search(
    query: string,
    freshness: RetrievalFreshness,
    maxResults: number,
  ): Promise<KnowledgeStoreSearchResult[]> {
    if (this.getDatabaseUrl()) {
      return this.searchPostgres(query, freshness, maxResults);
    }

    return this.searchFile(query, freshness, maxResults);
  }

  async upsertExtractedDocuments(
    documents: ExtractedDocument[],
    query: string,
    intent: string,
    retrievedAt: string,
    freshness: RetrievalFreshness = 'medium',
  ): Promise<KnowledgeStoreDocument[]> {
    if (this.getDatabaseUrl()) {
      return this.upsertPostgresDocuments(
        documents,
        query,
        intent,
        retrievedAt,
        freshness,
      );
    }

    return this.upsertFileDocuments(documents, query, intent, retrievedAt);
  }

  async recordRetrievalRun(run: KnowledgeStoreRetrievalRun): Promise<void> {
    if (!this.getDatabaseUrl()) {
      return;
    }

    await this.ensureDatabase();

    await this.getPool().query(
      `
INSERT INTO rag_retrieval_runs (
  id,
  correlation_id,
  query_text,
  intent,
  retrieval_mode,
  duration_ms,
  local_result_count,
  live_result_count,
  evidence_chunk_ids,
  diagnostics,
  retrieved_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10::jsonb, $11)
`,
      [
        createUuidV7(),
        run.correlationId,
        run.queryText,
        run.intent,
        run.retrievalMode,
        Math.max(0, Math.round(run.durationMs)),
        Math.max(0, Math.round(run.localResultCount)),
        Math.max(0, Math.round(run.liveResultCount)),
        run.evidenceChunkIds.filter((id) => this.isUuid(id)),
        JSON.stringify(run.diagnostics ?? {}),
        run.retrievedAt,
      ],
    );
  }

  async count(): Promise<number> {
    if (this.getDatabaseUrl()) {
      await this.ensureDatabase();

      const result = await this.getPool().query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM rag_source_documents',
      );

      return Number.parseInt(result.rows[0]?.count ?? '0', 10);
    }

    const store = await this.loadStore();

    return store.documents.length;
  }

  private async searchPostgres(
    query: string,
    freshness: RetrievalFreshness,
    maxResults: number,
  ): Promise<KnowledgeStoreSearchResult[]> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return [];
    }

    const queryTerms = this.tokenize(normalizedQuery);

    if (queryTerms.length === 0) {
      return [];
    }

    await this.ensureDatabase();

    const candidateLimit = Math.max(
      POSTGRES_MIN_CANDIDATES,
      maxResults * POSTGRES_CANDIDATE_MULTIPLIER,
    );
    const result = await this.getPool().query<ChunkRow>(
      `
WITH retrieval_query AS (
  SELECT websearch_to_tsquery('english', $1) AS tsquery
)
SELECT
  c.id::text AS evidence_id,
  c.chunk_index,
  c.source_title,
  c.source_url::text AS source_url,
  d.canonical_url::text AS canonical_url,
  c.source_domain,
  c.content,
  c.excerpt,
  c.provider_summary,
  c.intent,
  c.search_queries,
  c.published_at,
  c.first_retrieved_at,
  c.last_retrieved_at,
  c.last_seen_at,
  c.times_seen,
  c.content_hash,
  ts_rank_cd(c.search_vector, retrieval_query.tsquery) AS lexical_rank,
  GREATEST(
    similarity(c.source_title, $1),
    similarity(c.excerpt, $1),
    similarity(left(c.content, $4), $1)
  ) AS trigram_rank,
  c.source_quality_score,
  lower(c.source_title) LIKE lower($2) ESCAPE '\\' AS exact_title,
  lower(c.excerpt) LIKE lower($2) ESCAPE '\\' AS exact_excerpt,
  lower(left(c.content, $4)) LIKE lower($2) ESCAPE '\\' AS exact_content
FROM rag_document_chunks c
JOIN rag_source_documents d ON d.id = c.document_id
CROSS JOIN retrieval_query
WHERE
  c.search_vector @@ retrieval_query.tsquery
  OR similarity(c.source_title, $1) >= 0.12
  OR similarity(c.excerpt, $1) >= 0.12
  OR lower(c.source_title) LIKE lower($2) ESCAPE '\\'
  OR lower(c.excerpt) LIKE lower($2) ESCAPE '\\'
  OR lower(left(c.content, $4)) LIKE lower($2) ESCAPE '\\'
ORDER BY
  (
    ts_rank_cd(c.search_vector, retrieval_query.tsquery) * 8
    + GREATEST(
      similarity(c.source_title, $1),
      similarity(c.excerpt, $1),
      similarity(left(c.content, $4), $1)
    )
    + CASE WHEN lower(c.source_title) LIKE lower($2) ESCAPE '\\' THEN 0.35 ELSE 0 END
    + CASE WHEN lower(c.excerpt) LIKE lower($2) ESCAPE '\\' THEN 0.25 ELSE 0 END
    + CASE WHEN lower(left(c.content, $4)) LIKE lower($2) ESCAPE '\\' THEN 0.15 ELSE 0 END
  ) DESC,
  c.last_retrieved_at DESC
LIMIT $3
`,
      [
        normalizedQuery,
        `%${this.escapeLikePattern(normalizedQuery)}%`,
        candidateLimit,
        SEARCH_CONTENT_WINDOW,
      ],
    );

    const scoredResults = result.rows.map((row) => {
      const document = this.mapChunkRowToDocument(row);
      const freshnessScore = this.scoreFreshness(document, freshness);
      const relevanceScore = this.scorePostgresRelevance(row);
      const sourceQualityScore = this.toNumber(row.source_quality_score);
      const score = this.scoreHybridCandidate({
        relevanceScore,
        freshnessScore,
        sourceQualityScore,
        freshness,
      });

      return {
        document,
        relevanceScore,
        freshnessScore,
        score,
      };
    });

    return selectDiverseResults(
      scoredResults,
      maxResults,
      (result) =>
        result.document.sourceDomain ??
        getSourceDomain(result.document.sourceUrl),
      (result) => result.score,
    );
  }

  private async upsertPostgresDocuments(
    documents: ExtractedDocument[],
    query: string,
    intent: string,
    retrievedAt: string,
    freshness: RetrievalFreshness,
  ): Promise<KnowledgeStoreDocument[]> {
    if (documents.length === 0) {
      return [];
    }

    await this.ensureDatabase();

    const client = await this.getPool().connect();
    const upserted: KnowledgeStoreDocument[] = [];

    try {
      await client.query('BEGIN');

      for (const document of documents) {
        const content = this.limitText(
          document.content || document.excerpt,
          MAX_POSTGRES_CONTENT_LENGTH,
        );

        if (!content.trim()) {
          continue;
        }

        const normalizedDocument = this.toKnowledgeDocument(
          document,
          content,
          query,
          intent,
          retrievedAt,
        );
        const existing = await this.findExistingPostgresDocument(
          client,
          normalizedDocument.canonicalUrl ?? null,
          normalizedDocument.sourceUrl,
          normalizedDocument.contentHash,
        );
        const saved = existing
          ? await this.updatePostgresDocument(
              client,
              existing,
              normalizedDocument,
              query,
              document,
              retrievedAt,
              freshness,
            )
          : await this.insertPostgresDocument(
              client,
              normalizedDocument,
              document,
              freshness,
            );

        upserted.push(saved);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return upserted;
  }

  private async insertPostgresDocument(
    client: PoolClient,
    document: KnowledgeStoreDocument,
    extractedDocument: ExtractedDocument,
    freshness: RetrievalFreshness,
  ): Promise<KnowledgeStoreDocument> {
    const metadata = this.buildDocumentMetadata(extractedDocument);
    const chunks = chunkKnowledgeContent({
      documentId: document.evidenceId,
      content: document.content,
    });
    const refreshPolicy = computeRefreshPolicy({
      publishedAt: document.publishedAt,
      retrievedAt: document.lastRetrievedAt,
      freshnessIntent: freshness,
      sourceUrl: document.sourceUrl,
    });
    const rawContentHash = hashText(
      extractedDocument.content ||
        extractedDocument.excerpt ||
        document.content,
    );

    await client.query(
      `
INSERT INTO rag_source_documents (
  id,
  source_title,
  source_url,
  canonical_url,
  source_domain,
  source_kind,
  provider_summary,
  intent,
  search_queries,
  published_at,
  first_retrieved_at,
  last_retrieved_at,
  last_seen_at,
  times_seen,
  content_hash,
  raw_content_hash,
  cleaned_content_hash,
  chunk_count,
  extraction_provider,
  refresh_after,
  refresh_reason,
  last_refresh_status,
  metadata
) VALUES (
  $1, $2, $3, $4, $5, 'web', $6, $7, $8::text[], $9, $10, $11, $12, $13,
  $14, $15, $16, $17, 'exa', $18, $19, 'ok', $20::jsonb
)
`,
      [
        document.evidenceId,
        document.sourceTitle,
        document.sourceUrl,
        document.canonicalUrl,
        document.sourceDomain,
        document.providerSummary,
        document.intent,
        document.searchQueries,
        document.publishedAt,
        document.firstRetrievedAt,
        document.lastRetrievedAt,
        document.lastSeenAt,
        document.timesSeen,
        document.contentHash,
        rawContentHash,
        document.contentHash,
        Math.max(1, chunks.length),
        refreshPolicy.refreshAfter,
        refreshPolicy.refreshReason,
        JSON.stringify(metadata),
      ],
    );

    await this.insertPostgresChunks(client, document, chunks, metadata);

    return this.mapPreparedChunkToDocument(document, chunks[0] ?? null);
  }

  private async insertPostgresChunks(
    client: PoolClient,
    document: KnowledgeStoreDocument,
    chunks: KnowledgeChunk[],
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const sourceQualityScore = scoreSourceQuality({
      sourceUrl: document.sourceUrl,
      sourceTitle: document.sourceTitle,
    });

    for (const chunk of chunks) {
      await client.query(
        `
INSERT INTO rag_document_chunks (
  id,
  document_id,
  chunk_index,
  stable_chunk_key,
  source_title,
  source_url,
  source_domain,
  content,
  excerpt,
  provider_summary,
  intent,
  search_queries,
  published_at,
  first_retrieved_at,
  last_retrieved_at,
  last_seen_at,
  times_seen,
  content_hash,
  start_offset,
  end_offset,
  source_quality_score,
  search_vector,
  metadata
) VALUES (
  $1,
  $2,
  $3,
  $4,
  $5,
  $6,
  $7,
  $8,
  $9,
  $10,
  $11,
  $12::text[],
  $13,
  $14,
  $15,
  $16,
  $17,
  $18,
  $19,
  $20,
  $21,
  setweight(to_tsvector('english', coalesce($5, '')), 'A')
    || setweight(to_tsvector('english', coalesce($9, '')), 'B')
    || setweight(to_tsvector('english', coalesce($8, '')), 'C'),
  $22::jsonb
)
ON CONFLICT (stable_chunk_key) WHERE stable_chunk_key IS NOT NULL DO UPDATE
SET
  source_title = EXCLUDED.source_title,
  source_url = EXCLUDED.source_url,
  source_domain = EXCLUDED.source_domain,
  content = EXCLUDED.content,
  excerpt = EXCLUDED.excerpt,
  provider_summary = EXCLUDED.provider_summary,
  intent = EXCLUDED.intent,
  search_queries = EXCLUDED.search_queries,
  published_at = EXCLUDED.published_at,
  last_retrieved_at = EXCLUDED.last_retrieved_at,
  last_seen_at = EXCLUDED.last_seen_at,
  times_seen = rag_document_chunks.times_seen + 1,
  content_hash = EXCLUDED.content_hash,
  start_offset = EXCLUDED.start_offset,
  end_offset = EXCLUDED.end_offset,
  source_quality_score = EXCLUDED.source_quality_score,
  search_vector = EXCLUDED.search_vector,
  needs_embedding = rag_document_chunks.embedding IS NULL,
  metadata = rag_document_chunks.metadata || EXCLUDED.metadata,
  updated_at = now()
`,
        [
          chunk.id,
          document.evidenceId,
          chunk.index,
          this.buildStableChunkKey(document, chunk),
          document.sourceTitle,
          document.sourceUrl,
          document.sourceDomain,
          chunk.content,
          chunk.excerpt,
          document.providerSummary,
          document.intent,
          document.searchQueries,
          document.publishedAt,
          document.firstRetrievedAt,
          document.lastRetrievedAt,
          document.lastSeenAt,
          document.timesSeen,
          chunk.contentHash,
          chunk.startOffset,
          chunk.endOffset,
          sourceQualityScore,
          JSON.stringify({
            ...metadata,
            chunking: {
              algorithm: 'fixed-window-sentence-boundary-v1',
              startOffset: chunk.startOffset,
              endOffset: chunk.endOffset,
            },
          }),
        ],
      );

      await client.query(
        `
INSERT INTO rag_embedding_jobs (id, chunk_id, status, embedding_model)
VALUES ($1, $2, 'pending', $3)
ON CONFLICT (chunk_id, embedding_model) DO UPDATE
SET
  status = CASE
    WHEN rag_embedding_jobs.status = 'done' THEN rag_embedding_jobs.status
    ELSE 'pending'
  END,
  available_after = LEAST(rag_embedding_jobs.available_after, now()),
  updated_at = now()
`,
        [createUuidV7(), chunk.id, this.embeddingModelId],
      );
    }
  }

  async claimPendingEmbeddingJobs(
    batchSize: number,
  ): Promise<EmbeddingJobClaim[]> {
    if (!this.getDatabaseUrl()) {
      return [];
    }

    await this.ensureDatabase();

    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      const result = await client.query<EmbeddingJobClaimRow>(
        `
WITH claimed AS (
  SELECT id
  FROM rag_embedding_jobs
  WHERE embedding_model = $2
    AND available_after <= now()
    AND (
      status = 'pending'
      OR (
        status = 'in_progress'
        AND updated_at < now() - ($3::int) * interval '1 millisecond'
      )
    )
  ORDER BY priority DESC, available_after ASC, created_at ASC
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
UPDATE rag_embedding_jobs
SET status = 'in_progress',
    attempts = rag_embedding_jobs.attempts + 1,
    updated_at = now()
FROM claimed, rag_document_chunks c
WHERE rag_embedding_jobs.id = claimed.id
  AND c.id = rag_embedding_jobs.chunk_id
RETURNING
  rag_embedding_jobs.id::text AS job_id,
  rag_embedding_jobs.chunk_id::text AS chunk_id,
  rag_embedding_jobs.attempts AS attempts,
  c.content AS content
`,
        [
          Math.max(1, Math.floor(batchSize)),
          this.embeddingModelId,
          EMBEDDING_JOB_STALE_AFTER_MS,
        ],
      );
      await client.query('COMMIT');

      return result.rows.map((row) => ({
        jobId: row.job_id,
        chunkId: row.chunk_id,
        attempts: row.attempts,
        content: row.content,
      }));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async writeChunkEmbedding(input: {
    jobId: string;
    chunkId: string;
    embedding: number[];
    embeddingModel: string;
  }): Promise<void> {
    if (!this.getDatabaseUrl()) {
      return;
    }

    await this.ensureDatabase();

    const literal = this.toVectorLiteral(input.embedding);
    const client = await this.getPool().connect();

    try {
      await client.query('BEGIN');
      await client.query(
        `
UPDATE rag_document_chunks
SET
  embedding = $1::vector,
  embedding_model = $2,
  embedding_dimensions = $3,
  embedding_updated_at = now(),
  needs_embedding = false,
  updated_at = now()
WHERE id = $4
`,
        [literal, input.embeddingModel, input.embedding.length, input.chunkId],
      );
      await client.query(
        `
UPDATE rag_embedding_jobs
SET
  status = 'done',
  error = NULL,
  updated_at = now()
WHERE id = $1
`,
        [input.jobId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async markEmbeddingJobFailed(input: {
    jobId: string;
    error: string;
    backoffMs: number;
    maxAttempts: number;
  }): Promise<void> {
    if (!this.getDatabaseUrl()) {
      return;
    }

    await this.ensureDatabase();

    await this.getPool().query(
      `
UPDATE rag_embedding_jobs
SET
  status = CASE
    WHEN attempts >= $4 THEN 'failed'
    ELSE 'pending'
  END,
  error = $2,
  available_after = now() + ($3::int) * interval '1 millisecond',
  updated_at = now()
WHERE id = $1
`,
      [
        input.jobId,
        truncate(input.error, 1000),
        Math.max(0, Math.floor(input.backoffMs)),
        Math.max(1, Math.floor(input.maxAttempts)),
      ],
    );
  }

  async releaseEmbeddingJob(input: {
    jobId: string;
    reason: string;
  }): Promise<void> {
    if (!this.getDatabaseUrl()) {
      return;
    }

    await this.ensureDatabase();

    await this.getPool().query(
      `
UPDATE rag_embedding_jobs
SET
  status = 'pending',
  error = $2,
  available_after = now(),
  updated_at = now()
WHERE id = $1
`,
      [input.jobId, truncate(input.reason, 1000)],
    );
  }

  async getEmbeddingJobStats(): Promise<EmbeddingJobStats> {
    if (!this.getDatabaseUrl()) {
      return {
        configuredModel: this.embeddingModelId,
        configuredDimensions: this.embeddingDimensions,
        pending: 0,
        inProgress: 0,
        done: 0,
        failed: 0,
        embeddedChunks: 0,
        chunksAwaitingEmbedding: 0,
      };
    }

    await this.ensureDatabase();

    const [jobsResult, chunkResult] = await Promise.all([
      this.getPool().query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text AS count FROM rag_embedding_jobs GROUP BY status`,
      ),
      this.getPool().query<{ embedded: string; awaiting: string }>(
        `
SELECT
  COUNT(*) FILTER (WHERE embedding IS NOT NULL)::text AS embedded,
  COUNT(*) FILTER (WHERE needs_embedding = true)::text AS awaiting
FROM rag_document_chunks
`,
      ),
    ]);

    const stats: EmbeddingJobStats = {
      configuredModel: this.embeddingModelId,
      configuredDimensions: this.embeddingDimensions,
      pending: 0,
      inProgress: 0,
      done: 0,
      failed: 0,
      embeddedChunks: Number.parseInt(chunkResult.rows[0]?.embedded ?? '0', 10),
      chunksAwaitingEmbedding: Number.parseInt(
        chunkResult.rows[0]?.awaiting ?? '0',
        10,
      ),
    };

    for (const row of jobsResult.rows) {
      const count = Number.parseInt(row.count ?? '0', 10);
      if (row.status === 'pending') stats.pending = count;
      else if (row.status === 'in_progress') stats.inProgress = count;
      else if (row.status === 'done') stats.done = count;
      else if (row.status === 'failed') stats.failed = count;
    }

    return stats;
  }

  async searchByEmbedding(
    queryEmbedding: number[],
    freshness: RetrievalFreshness,
    maxResults: number,
  ): Promise<KnowledgeStoreSearchResult[]> {
    if (!this.getDatabaseUrl() || queryEmbedding.length === 0) {
      return [];
    }

    await this.ensureDatabase();

    const literal = this.toVectorLiteral(queryEmbedding);
    const candidateLimit = Math.max(
      POSTGRES_MIN_CANDIDATES,
      maxResults * POSTGRES_CANDIDATE_MULTIPLIER,
    );

    const result = await this.getPool().query<ChunkRow>(
      `
SELECT
  c.id::text AS evidence_id,
  c.chunk_index,
  c.source_title,
  c.source_url::text AS source_url,
  d.canonical_url::text AS canonical_url,
  c.source_domain,
  c.content,
  c.excerpt,
  c.provider_summary,
  c.intent,
  c.search_queries,
  c.published_at,
  c.first_retrieved_at,
  c.last_retrieved_at,
  c.last_seen_at,
  c.times_seen,
  c.content_hash,
  c.source_quality_score,
  (1 - (c.embedding <=> $1::vector)) AS vector_similarity
FROM rag_document_chunks c
JOIN rag_source_documents d ON d.id = c.document_id
WHERE c.embedding IS NOT NULL
  AND c.embedding_dimensions = $3
ORDER BY c.embedding <=> $1::vector ASC
LIMIT $2
`,
      [literal, candidateLimit, queryEmbedding.length],
    );

    const scored = result.rows.map((row) => {
      const document = this.mapChunkRowToDocument(row);
      const similarity = clampUnit(this.toNumber(row.vector_similarity));
      const freshnessScore = this.scoreFreshness(document, freshness);
      const sourceQualityScore = this.toNumber(row.source_quality_score);
      const score = this.scoreHybridCandidate({
        relevanceScore: similarity,
        freshnessScore,
        sourceQualityScore,
        freshness,
      });

      return {
        document,
        relevanceScore: similarity,
        freshnessScore,
        score,
      };
    });

    return selectDiverseResults(
      scored,
      maxResults,
      (entry) =>
        entry.document.sourceDomain ??
        getSourceDomain(entry.document.sourceUrl),
      (entry) => entry.score,
    );
  }

  async searchHybrid(
    queryText: string,
    queryEmbedding: number[] | null,
    freshness: RetrievalFreshness,
    maxResults: number,
  ): Promise<KnowledgeStoreSearchResult[]> {
    if (!queryEmbedding || queryEmbedding.length === 0) {
      return this.search(queryText, freshness, maxResults);
    }

    const oversample = Math.max(maxResults, 6) * 2;
    const [lexical, vector] = await Promise.all([
      this.search(queryText, freshness, oversample),
      this.searchByEmbedding(queryEmbedding, freshness, oversample),
    ]);

    if (lexical.length === 0 && vector.length === 0) {
      return [];
    }

    if (vector.length === 0) {
      return lexical.slice(0, maxResults);
    }

    if (lexical.length === 0) {
      return vector.slice(0, maxResults);
    }

    const fused = new Map<string, KnowledgeStoreSearchResult>();
    const lexicalIndex = new Map<string, number>();
    const vectorIndex = new Map<string, number>();

    lexical.forEach((entry, index) => {
      lexicalIndex.set(entry.document.evidenceId, index);
      fused.set(entry.document.evidenceId, entry);
    });

    vector.forEach((entry, index) => {
      vectorIndex.set(entry.document.evidenceId, index);
      const existing = fused.get(entry.document.evidenceId);
      if (!existing || entry.relevanceScore > existing.relevanceScore) {
        fused.set(entry.document.evidenceId, entry);
      }
    });

    const FUSE_K = 60;
    const blended: KnowledgeStoreSearchResult[] = [];

    for (const [evidenceId, entry] of fused) {
      const lexicalRank = lexicalIndex.get(evidenceId);
      const vectorRank = vectorIndex.get(evidenceId);
      const lexicalContribution =
        typeof lexicalRank === 'number' ? 1 / (FUSE_K + lexicalRank) : 0;
      const vectorContribution =
        typeof vectorRank === 'number' ? 1 / (FUSE_K + vectorRank) : 0;
      const fusedScore = clampUnit(
        (lexicalContribution + vectorContribution) * (FUSE_K + 1),
      );

      blended.push({
        document: entry.document,
        relevanceScore: entry.relevanceScore,
        freshnessScore: entry.freshnessScore,
        score: clampUnit(0.55 * fusedScore + 0.45 * entry.score),
      });
    }

    blended.sort((left, right) => right.score - left.score);

    return selectDiverseResults(
      blended,
      maxResults,
      (entry) =>
        entry.document.sourceDomain ??
        getSourceDomain(entry.document.sourceUrl),
      (entry) => entry.score,
    );
  }

  private get embeddingModelId(): string {
    return (
      this.configService.get<string>('EMBEDDING_SERVICE_MODEL_ID') ||
      serviceRuntimeConfig.embeddingService.modelId
    );
  }

  private get embeddingDimensions(): number {
    const raw =
      this.configService.get<string>('EMBEDDING_SERVICE_DIMENSIONS') ||
      String(serviceRuntimeConfig.embeddingService.dimensions);
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : serviceRuntimeConfig.embeddingService.dimensions;
  }

  private toVectorLiteral(embedding: number[]): string {
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(
        'Cannot serialize empty embedding to a pgvector literal.',
      );
    }

    const parts = embedding.map((value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('Embedding contained a non-finite value.');
      }
      return value.toString();
    });

    return `[${parts.join(',')}]`;
  }

  private mapPreparedChunkToDocument(
    document: KnowledgeStoreDocument,
    chunk: KnowledgeChunk | null,
  ): KnowledgeStoreDocument {
    if (!chunk) {
      return document;
    }

    return {
      ...document,
      evidenceId: chunk.id,
      content: chunk.content,
      excerpt: chunk.excerpt,
      contentHash: chunk.contentHash,
      chunkIndex: chunk.index,
      sourceQualityScore: scoreSourceQuality({
        sourceUrl: document.sourceUrl,
        sourceTitle: document.sourceTitle,
      }),
    };
  }

  private async updatePostgresDocument(
    client: PoolClient,
    existing: ExistingDocumentRow,
    incoming: KnowledgeStoreDocument,
    query: string,
    extractedDocument: ExtractedDocument,
    retrievedAt: string,
    freshness: RetrievalFreshness,
  ): Promise<KnowledgeStoreDocument> {
    const searchQueries = this.mergeSearchQueries(
      existing.search_queries,
      query,
    );
    const metadata = this.buildDocumentMetadata(extractedDocument);
    const document: KnowledgeStoreDocument = {
      ...incoming,
      evidenceId: existing.id,
      searchQueries,
      timesSeen: existing.times_seen + 1,
      lastRetrievedAt: retrievedAt,
      lastSeenAt: retrievedAt,
    };
    const chunks = chunkKnowledgeContent({
      documentId: document.evidenceId,
      content: document.content,
    });
    const refreshPolicy = computeRefreshPolicy({
      publishedAt: document.publishedAt,
      retrievedAt,
      freshnessIntent: freshness,
      sourceUrl: document.sourceUrl,
    });
    const rawContentHash = hashText(
      extractedDocument.content ||
        extractedDocument.excerpt ||
        document.content,
    );

    await client.query(
      `
UPDATE rag_source_documents
SET
  source_title = $2,
  source_url = COALESCE($3, source_url),
  canonical_url = COALESCE($4, canonical_url),
  source_domain = COALESCE($5, source_domain),
  provider_summary = COALESCE($6, provider_summary),
  intent = $7,
  search_queries = $8::text[],
  published_at = COALESCE($9, published_at),
  last_retrieved_at = $10,
  last_seen_at = $10,
  times_seen = times_seen + 1,
  content_hash = $11,
  raw_content_hash = $12,
  cleaned_content_hash = $13,
  chunk_count = $14,
  extraction_provider = 'exa',
  refresh_after = $15,
  refresh_reason = $16,
  last_refresh_status = 'ok',
  metadata = metadata || $17::jsonb,
  updated_at = now()
WHERE id = $1
`,
      [
        existing.id,
        document.sourceTitle,
        document.sourceUrl,
        document.canonicalUrl,
        document.sourceDomain,
        document.providerSummary,
        document.intent,
        searchQueries,
        document.publishedAt,
        retrievedAt,
        document.contentHash,
        rawContentHash,
        document.contentHash,
        Math.max(1, chunks.length),
        refreshPolicy.refreshAfter,
        refreshPolicy.refreshReason,
        JSON.stringify(metadata),
      ],
    );

    await client.query(
      'DELETE FROM rag_document_chunks WHERE document_id = $1',
      [existing.id],
    );
    await this.insertPostgresChunks(client, document, chunks, metadata);

    return this.mapPreparedChunkToDocument(document, chunks[0] ?? null);
  }

  private async findExistingPostgresDocument(
    client: PoolClient,
    canonicalUrl: string | null,
    sourceUrl: string | null,
    contentHash: string,
  ): Promise<ExistingDocumentRow | null> {
    const result = await client.query<ExistingDocumentRow>(
      `
SELECT id::text, search_queries, times_seen
FROM rag_source_documents
WHERE
  ($1::citext IS NOT NULL AND canonical_url = $1::citext)
  OR ($2::citext IS NOT NULL AND source_url = $2::citext)
  OR content_hash = $3
ORDER BY
  CASE
    WHEN $1::citext IS NOT NULL AND canonical_url = $1::citext THEN 0
    WHEN $2::citext IS NOT NULL AND source_url = $2::citext THEN 1
    ELSE 2
  END
LIMIT 1
`,
      [canonicalUrl, sourceUrl, contentHash],
    );

    return result.rows[0] ?? null;
  }

  private async searchFile(
    query: string,
    freshness: RetrievalFreshness,
    maxResults: number,
  ): Promise<KnowledgeStoreSearchResult[]> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      return [];
    }

    const store = await this.loadStore();
    const queryTerms = this.tokenize(normalizedQuery);

    if (queryTerms.length === 0) {
      return [];
    }

    return store.documents
      .map((document) =>
        this.scoreDocument(document, normalizedQuery, queryTerms, freshness),
      )
      .filter((result): result is KnowledgeStoreSearchResult => Boolean(result))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return (
          Date.parse(right.document.lastRetrievedAt) -
          Date.parse(left.document.lastRetrievedAt)
        );
      })
      .slice(0, maxResults);
  }

  private async upsertFileDocuments(
    documents: ExtractedDocument[],
    query: string,
    intent: string,
    retrievedAt: string,
  ): Promise<KnowledgeStoreDocument[]> {
    if (documents.length === 0) {
      return [];
    }

    const store = await this.loadStore();
    const upserted: KnowledgeStoreDocument[] = [];

    for (const document of documents) {
      const content = this.limitText(document.content || document.excerpt);

      if (!content.trim()) {
        continue;
      }

      const normalizedDocument = this.toKnowledgeDocument(
        document,
        content,
        query,
        intent,
        retrievedAt,
      );
      const existingIndex = store.documents.findIndex((candidate) =>
        this.isSameDocument(candidate, normalizedDocument),
      );

      if (existingIndex >= 0) {
        const existing = store.documents[existingIndex];
        const merged = this.mergeDocument(
          existing,
          normalizedDocument,
          query,
          retrievedAt,
        );

        store.documents[existingIndex] = merged;
        upserted.push(merged);
      } else {
        store.documents.unshift(normalizedDocument);
        upserted.push(normalizedDocument);
      }
    }

    store.documents = store.documents
      .sort(
        (left, right) =>
          Date.parse(right.lastRetrievedAt) - Date.parse(left.lastRetrievedAt),
      )
      .slice(0, MAX_STORED_DOCUMENTS);
    store.updatedAt = retrievedAt;

    await this.persistStore(store);

    return upserted;
  }

  private async ensureDatabase(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.runMigrations().catch((error) => {
        this.schemaReady = null;
        throw error;
      });
    }

    await this.schemaReady;
  }

  private async runMigrations(): Promise<void> {
    const client = await this.getPool().connect();

    try {
      await client.query(
        "SELECT pg_advisory_lock(hashtext('swirlock_rag_knowledge_store_schema'))",
      );
      await client.query(`
CREATE TABLE IF NOT EXISTS rag_schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
)
`);

      for (const migration of KNOWLEDGE_STORE_MIGRATIONS) {
        const existing = await client.query(
          'SELECT 1 FROM rag_schema_migrations WHERE version = $1',
          [migration.version],
        );

        if (existing.rowCount) {
          continue;
        }

        try {
          await client.query('BEGIN');
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO rag_schema_migrations (version, name) VALUES ($1, $2)',
            [migration.version, migration.name],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    } finally {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('swirlock_rag_knowledge_store_schema'))",
        );
      } finally {
        client.release();
      }
    }
  }

  private getPool(): Pool {
    if (!this.pool) {
      const connectionString = this.getDatabaseUrl();

      if (!connectionString) {
        throw new Error('RAG_DATABASE_URL is not configured.');
      }

      this.pool = new Pool({
        connectionString,
        application_name: serviceRuntimeConfig.serviceName,
        statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
        connectionTimeoutMillis: 5000,
        max: 10,
      });
    }

    return this.pool;
  }

  private getDatabaseUrl(): string {
    return this.configService.get<string>('RAG_DATABASE_URL')?.trim() ?? '';
  }

  private async loadStore(): Promise<KnowledgeStoreFile> {
    if (this.store) {
      return this.store;
    }

    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<KnowledgeStoreFile>;

      this.store = {
        schemaVersion: STORE_SCHEMA_VERSION,
        updatedAt:
          typeof parsed.updatedAt === 'string'
            ? parsed.updatedAt
            : new Date().toISOString(),
        documents: Array.isArray(parsed.documents)
          ? parsed.documents.filter((document) =>
              this.isKnowledgeStoreDocument(document),
            )
          : [],
      };
    } catch (error) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? String((error as { code: unknown }).code)
          : '';

      if (code !== 'ENOENT') {
        this.logger.warn(
          `Knowledge store could not be read. Starting with an empty store. ${this.getErrorMessage(error)}`,
        );
      }

      this.store = {
        schemaVersion: STORE_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        documents: [],
      };
    }

    return this.store;
  }

  private async persistStore(store: KnowledgeStoreFile): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(dirname(this.storePath), { recursive: true });
      const tempPath = `${this.storePath}.tmp`;
      const content = `${JSON.stringify(store, null, 2)}\n`;

      await fs.writeFile(tempPath, content, 'utf8');
      await fs.rename(tempPath, this.storePath);
    });

    await this.writeQueue;
  }

  private toKnowledgeDocument(
    document: ExtractedDocument,
    content: string,
    query: string,
    intent: string,
    retrievedAt: string,
  ): KnowledgeStoreDocument {
    const sourceUrl = document.url || null;
    const canonicalUrl = canonicalizeUrl(sourceUrl);
    const contentHash = hashText(content);
    const sourceTitle = document.title || document.url;

    return {
      evidenceId: createStableDocumentId({
        canonicalUrl,
        contentHash,
        title: sourceTitle,
      }),
      sourceTitle,
      sourceUrl,
      canonicalUrl,
      sourceDomain: getSourceDomain(canonicalUrl),
      content,
      excerpt: this.limitText(document.excerpt || content, 1500),
      providerSummary: document.providerSummary,
      intent,
      searchQueries: [query],
      publishedAt: document.publishedAt,
      firstRetrievedAt: retrievedAt,
      lastRetrievedAt: retrievedAt,
      lastSeenAt: retrievedAt,
      timesSeen: 1,
      contentHash,
    };
  }

  private mergeDocument(
    existing: KnowledgeStoreDocument,
    incoming: KnowledgeStoreDocument,
    query: string,
    retrievedAt: string,
  ): KnowledgeStoreDocument {
    return {
      ...existing,
      sourceTitle: incoming.sourceTitle || existing.sourceTitle,
      sourceUrl: incoming.sourceUrl || existing.sourceUrl,
      content: incoming.content || existing.content,
      excerpt: incoming.excerpt || existing.excerpt,
      providerSummary: incoming.providerSummary ?? existing.providerSummary,
      intent: incoming.intent || existing.intent,
      searchQueries: this.mergeSearchQueries(existing.searchQueries, query),
      publishedAt: incoming.publishedAt ?? existing.publishedAt,
      lastRetrievedAt: retrievedAt,
      lastSeenAt: retrievedAt,
      timesSeen: existing.timesSeen + 1,
      contentHash: incoming.contentHash,
    };
  }

  private scoreDocument(
    document: KnowledgeStoreDocument,
    normalizedQuery: string,
    queryTerms: string[],
    freshness: RetrievalFreshness,
  ): KnowledgeStoreSearchResult | null {
    const title = document.sourceTitle.toLowerCase();
    const excerpt = document.excerpt.toLowerCase();
    const content = document.content
      .slice(0, SEARCH_CONTENT_WINDOW)
      .toLowerCase();
    const normalizedQueryLower = normalizedQuery.toLowerCase();
    let relevancePoints = 0;

    for (const term of queryTerms) {
      relevancePoints += this.countTerm(title, term) * 6;
      relevancePoints += this.countTerm(excerpt, term) * 3;
      relevancePoints += Math.min(this.countTerm(content, term), 8);
    }

    if (
      title.includes(normalizedQueryLower) ||
      excerpt.includes(normalizedQueryLower) ||
      content.includes(normalizedQueryLower)
    ) {
      relevancePoints += 12;
    }

    if (
      document.searchQueries.some(
        (storedQuery) =>
          storedQuery.trim().toLowerCase() === normalizedQueryLower,
      )
    ) {
      relevancePoints += 8;
    }

    if (relevancePoints <= 0) {
      return null;
    }

    const freshnessScore = this.scoreFreshness(document, freshness);
    const score = relevancePoints + freshnessScore * 8;

    return {
      document,
      relevanceScore: this.roundScore(relevancePoints / (relevancePoints + 18)),
      freshnessScore,
      score,
    };
  }

  private scorePostgresRelevance(row: ChunkRow): number {
    const lexicalRank = this.toNumber(row.lexical_rank);
    const trigramRank = this.toNumber(row.trigram_rank);
    const exactBoost =
      (row.exact_title ? 0.25 : 0) +
      (row.exact_excerpt ? 0.18 : 0) +
      (row.exact_content ? 0.12 : 0);

    return this.roundScore(
      Math.min(1, lexicalRank * 5 + trigramRank * 0.75 + exactBoost),
    );
  }

  private scoreHybridCandidate(input: {
    relevanceScore: number;
    freshnessScore: number;
    sourceQualityScore: number;
    freshness: RetrievalFreshness;
  }): number {
    const freshnessWeight =
      input.freshness === 'realtime'
        ? 0.35
        : input.freshness === 'high'
          ? 0.28
          : input.freshness === 'medium'
            ? 0.18
            : 0.08;
    const sourceQualityWeight = 0.1;
    const relevanceWeight = 1 - freshnessWeight - sourceQualityWeight;

    return this.roundScore(
      input.relevanceScore * relevanceWeight +
        input.freshnessScore * freshnessWeight +
        input.sourceQualityScore * sourceQualityWeight,
    );
  }

  private scoreFreshness(
    document: KnowledgeStoreDocument,
    freshness: RetrievalFreshness,
  ): number {
    const timestamp =
      Date.parse(document.publishedAt ?? '') ||
      Date.parse(document.lastRetrievedAt);
    const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);

    if (!Number.isFinite(ageDays) || ageDays < 0) {
      return 0.5;
    }

    switch (freshness) {
      case 'realtime':
        return this.decay(ageDays, 1);
      case 'high':
        return this.decay(ageDays, 7);
      case 'medium':
        return this.decay(ageDays, 45);
      default:
        return this.decay(ageDays, 365);
    }
  }

  private decay(ageDays: number, halfLifeDays: number): number {
    return this.roundScore(Math.exp(-ageDays / halfLifeDays));
  }

  private mapChunkRowToDocument(row: ChunkRow): KnowledgeStoreDocument {
    return {
      evidenceId: row.evidence_id,
      sourceTitle: row.source_title,
      sourceUrl: row.source_url,
      canonicalUrl: row.canonical_url,
      sourceDomain: row.source_domain,
      content: row.content,
      excerpt: row.excerpt,
      providerSummary: row.provider_summary,
      intent: row.intent,
      searchQueries: Array.isArray(row.search_queries)
        ? row.search_queries
        : [],
      publishedAt: this.formatTimestamp(row.published_at),
      firstRetrievedAt: this.formatRequiredTimestamp(row.first_retrieved_at),
      lastRetrievedAt: this.formatRequiredTimestamp(row.last_retrieved_at),
      lastSeenAt: this.formatRequiredTimestamp(row.last_seen_at),
      timesSeen: Number(row.times_seen) || 1,
      contentHash: row.content_hash,
      chunkIndex: Number(row.chunk_index) || 0,
      sourceQualityScore: this.toNumber(row.source_quality_score),
    };
  }

  private buildDocumentMetadata(
    document: ExtractedDocument,
  ): Record<string, unknown> {
    return {
      sourceScore: document.score,
      contentLength: document.contentLength,
      structuredSummary: document.structuredSummary,
      weatherSnapshot: document.weatherSnapshot,
    };
  }

  private mergeSearchQueries(existing: string[], query: string): string[] {
    return [...new Set([query, ...existing].filter(Boolean))].slice(0, 20);
  }

  private buildStableChunkKey(
    document: KnowledgeStoreDocument,
    chunk: KnowledgeChunk,
  ): string {
    return `${document.canonicalUrl || document.contentHash}:${chunk.index}:${chunk.contentHash}`;
  }

  private tokenize(value: string): string[] {
    return [
      ...new Set(
        value
          .toLowerCase()
          .split(/[^a-z0-9]+/i)
          .map((term) => term.trim())
          .filter((term) => term.length >= 3)
          .filter((term) => !this.stopWords.has(term)),
      ),
    ];
  }

  private countTerm(value: string, term: string): number {
    const matches = value.match(
      new RegExp(`\\b${this.escapeForRegex(term)}\\b`, 'g'),
    );

    return matches?.length ?? 0;
  }

  private isSameDocument(
    left: KnowledgeStoreDocument,
    right: KnowledgeStoreDocument,
  ): boolean {
    if (left.sourceUrl && right.sourceUrl) {
      return left.sourceUrl === right.sourceUrl;
    }

    return left.contentHash === right.contentHash;
  }

  private isKnowledgeStoreDocument(
    value: unknown,
  ): value is KnowledgeStoreDocument {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const candidate = value as Partial<KnowledgeStoreDocument>;

    return (
      typeof candidate.evidenceId === 'string' &&
      typeof candidate.sourceTitle === 'string' &&
      typeof candidate.content === 'string' &&
      typeof candidate.excerpt === 'string' &&
      Array.isArray(candidate.searchQueries) &&
      typeof candidate.lastRetrievedAt === 'string'
    );
  }

  private limitText(
    value: string,
    maxLength = MAX_STORED_CONTENT_LENGTH,
  ): string {
    const normalized = value.replace(/\s+/g, ' ').trim();

    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
  }

  private roundScore(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }

  private toNumber(value: number | string | null | undefined): number {
    const numberValue =
      typeof value === 'number' ? value : Number.parseFloat(String(value ?? 0));

    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  private formatTimestamp(value: Date | string | null): string | null {
    if (!value) {
      return null;
    }

    const date = value instanceof Date ? value : new Date(value);

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  private formatRequiredTimestamp(value: Date | string): string {
    return this.formatTimestamp(value) ?? new Date().toISOString();
  }

  private escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, (match) => `\\${match}`);
  }

  private safeDatabaseLocation(databaseUrl: string): string {
    try {
      const parsed = new URL(databaseUrl);

      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    } catch {
      return 'postgresql://<configured>';
    }
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private readonly stopWords = new Set([
    'about',
    'after',
    'also',
    'and',
    'are',
    'for',
    'from',
    'has',
    'have',
    'how',
    'into',
    'latest',
    'more',
    'now',
    'the',
    'this',
    'today',
    'was',
    'what',
    'when',
    'where',
    'which',
    'with',
  ]);
}
