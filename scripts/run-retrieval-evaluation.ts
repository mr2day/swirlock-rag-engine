import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { KnowledgeStoreService } from '../src/retrieval/knowledge-store.service';
import type { RetrievalFreshness } from '../src/retrieval/retrieval.types';
import type { ExtractedDocument } from '../src/search/search.types';
import { loadScriptConfig } from './script-env';

interface EvaluationDocument {
  title: string;
  url: string;
  publishedAt: string | null;
  content: string;
  excerpt: string;
  intent: string;
  queries: string[];
}

interface EvaluationQuery {
  query: string;
  freshness: RetrievalFreshness;
  expectedUrl: string;
  k: number;
}

interface EvaluationFixture {
  minimumRecallAtK: number;
  documents: EvaluationDocument[];
  queries: EvaluationQuery[];
}

interface QueryEvaluationResult {
  query: string;
  expectedUrl: string;
  hit: boolean;
  topUrls: Array<string | null>;
}

async function main() {
  const fixturePath = resolve(
    getArgumentValue('--fixture') ?? 'eval/retrieval-golden.json',
  );
  const fixture = JSON.parse(
    readFileSync(fixturePath, 'utf8'),
  ) as EvaluationFixture;
  const tempDir = mkdtempSync(join(tmpdir(), 'swirlock-rag-eval-'));
  const { config } = loadScriptConfig({
    RAG_DATABASE_URL: '',
    RAG_KNOWLEDGE_STORE_PATH: join(tempDir, 'knowledge-store.json'),
  });
  const service = new KnowledgeStoreService(config as unknown as ConfigService);
  const startedAt = Date.now();
  const queryResults: QueryEvaluationResult[] = [];

  try {
    for (const document of fixture.documents) {
      await service.upsertExtractedDocuments(
        [toExtractedDocument(document)],
        document.queries[0] ?? 'evaluation seed',
        document.intent,
        '2026-05-02T00:00:00.000Z',
        'low',
      );
    }

    let hits = 0;

    for (const query of fixture.queries) {
      const results = await service.search(
        query.query,
        query.freshness,
        query.k,
      );
      const sourceUrls = results.map((result) => result.document.sourceUrl);
      const hit = sourceUrls.includes(query.expectedUrl);

      if (hit) {
        hits += 1;
      }

      queryResults.push({
        query: query.query,
        expectedUrl: query.expectedUrl,
        hit,
        topUrls: sourceUrls,
      });
    }

    const recallAtK =
      fixture.queries.length > 0 ? hits / fixture.queries.length : 0;
    const output = {
      fixture: fixturePath,
      documentCount: fixture.documents.length,
      queryCount: fixture.queries.length,
      recallAtK: Number(recallAtK.toFixed(4)),
      minimumRecallAtK: fixture.minimumRecallAtK,
      durationMs: Date.now() - startedAt,
      queries: queryResults,
    };

    console.log(JSON.stringify(output, null, 2));

    if (recallAtK < fixture.minimumRecallAtK) {
      process.exitCode = 1;
    }
  } finally {
    await service.onModuleDestroy();
  }
}

function toExtractedDocument(document: EvaluationDocument): ExtractedDocument {
  return {
    title: document.title,
    url: document.url,
    publishedAt: document.publishedAt,
    score: null,
    content: document.content,
    contentLength: document.content.length,
    excerpt: document.excerpt,
    providerSummary: null,
    structuredSummary: null,
    weatherSnapshot: null,
  };
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
