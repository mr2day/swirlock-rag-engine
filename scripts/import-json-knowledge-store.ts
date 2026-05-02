import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { KnowledgeStoreService } from '../src/retrieval/knowledge-store.service';
import type { ExtractedDocument } from '../src/search/search.types';
import { loadScriptConfig } from './script-env';

interface JsonKnowledgeDocument {
  sourceTitle: string;
  sourceUrl: string | null;
  content: string;
  excerpt: string;
  providerSummary: string | null;
  intent: string;
  searchQueries: string[];
  publishedAt: string | null;
  lastRetrievedAt: string;
}

interface JsonKnowledgeStore {
  documents?: JsonKnowledgeDocument[];
}

async function main() {
  const path = getArgumentValue('--path') ?? 'data/knowledge-store.json';
  const fullPath = resolve(path);

  if (!existsSync(fullPath)) {
    console.log(
      `No JSON knowledge store found at ${fullPath}. Nothing to import.`,
    );
    return;
  }

  const parsed = JSON.parse(
    readFileSync(fullPath, 'utf8'),
  ) as JsonKnowledgeStore;
  const documents = Array.isArray(parsed.documents) ? parsed.documents : [];

  if (documents.length === 0) {
    console.log(`JSON knowledge store at ${fullPath} has no documents.`);
    return;
  }

  const { config } = loadScriptConfig();
  const service = new KnowledgeStoreService(config as unknown as ConfigService);
  let imported = 0;

  try {
    for (const document of documents) {
      if (!isJsonKnowledgeDocument(document)) {
        continue;
      }

      await service.upsertExtractedDocuments(
        [toExtractedDocument(document)],
        document.searchQueries[0] || 'json knowledge import',
        document.intent || 'imported',
        document.lastRetrievedAt || new Date().toISOString(),
        'low',
      );
      imported += 1;
    }
  } finally {
    await service.onModuleDestroy();
  }

  console.log(
    `Imported ${imported} document(s) from ${fullPath} into ${service.storeKind}.`,
  );
}

function toExtractedDocument(
  document: JsonKnowledgeDocument,
): ExtractedDocument {
  return {
    title: document.sourceTitle,
    url: document.sourceUrl ?? '',
    publishedAt: document.publishedAt,
    score: null,
    content: document.content,
    contentLength: document.content.length,
    excerpt: document.excerpt,
    providerSummary: document.providerSummary,
    structuredSummary: null,
    weatherSnapshot: null,
  };
}

function isJsonKnowledgeDocument(
  value: unknown,
): value is JsonKnowledgeDocument {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<JsonKnowledgeDocument>;

  return (
    typeof candidate.sourceTitle === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.excerpt === 'string' &&
    Array.isArray(candidate.searchQueries) &&
    typeof candidate.lastRetrievedAt === 'string'
  );
}

function getArgumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);

  if (index < 0) {
    return undefined;
  }

  return process.argv[index + 1];
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
