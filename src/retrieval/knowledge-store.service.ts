import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createUuidV7 } from '../common/ids';
import { serviceRuntimeConfig } from '../config/service-config';
import type { ExtractedDocument } from '../search/search.types';
import type { RetrievalFreshness } from './retrieval.types';

const STORE_SCHEMA_VERSION = 1;
const MAX_STORED_DOCUMENTS = 500;
const MAX_STORED_CONTENT_LENGTH = 12000;
const SEARCH_CONTENT_WINDOW = 5000;

export interface KnowledgeStoreDocument {
  evidenceId: string;
  sourceTitle: string;
  sourceUrl: string | null;
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
}

export interface KnowledgeStoreSearchResult {
  document: KnowledgeStoreDocument;
  relevanceScore: number;
  freshnessScore: number;
  score: number;
}

interface KnowledgeStoreFile {
  schemaVersion: number;
  updatedAt: string;
  documents: KnowledgeStoreDocument[];
}

@Injectable()
export class KnowledgeStoreService {
  private readonly logger = new Logger(KnowledgeStoreService.name);
  private store: KnowledgeStoreFile | null = null;
  private writeQueue = Promise.resolve();

  constructor(private readonly configService: ConfigService) {}

  get storePath(): string {
    return (
      this.configService.get<string>('RAG_KNOWLEDGE_STORE_PATH') ||
      serviceRuntimeConfig.knowledgeStorePath
    );
  }

  async search(
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

  async upsertExtractedDocuments(
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

  async count(): Promise<number> {
    const store = await this.loadStore();

    return store.documents.length;
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
    return {
      evidenceId: createUuidV7(),
      sourceTitle: document.title || document.url,
      sourceUrl: document.url || null,
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
      contentHash: this.hashText(content),
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
      searchQueries: [...new Set([query, ...existing.searchQueries])].slice(
        0,
        20,
      ),
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
        (query) => query.trim().toLowerCase() === normalizedQueryLower,
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

  private hashText(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private roundScore(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(4))));
  }

  private escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
