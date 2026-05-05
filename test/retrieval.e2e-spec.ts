import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { ErrorEnvelope } from '../src/common/api-envelope';
import { AppModule } from './../src/app.module';
import { EmbeddingServiceService } from '../src/retrieval/embedding-service.service';
import { EmbeddingWorkerService } from '../src/retrieval/embedding-worker.service';
import type { RetrieveEvidenceResponse } from '../src/retrieval/retrieval.types';
import { UtilityLlmService } from '../src/retrieval/utility-llm.service';

describe('RetrievalController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(UtilityLlmService)
      .useValue({
        getConfiguration: jest.fn().mockReturnValue({
          enabled: false,
          configuredUrl: 'http://127.0.0.1:3213',
        }),
        getStatus: jest.fn().mockResolvedValue({
          enabled: false,
          configuredUrl: 'http://127.0.0.1:3213',
          ready: false,
          durationMs: 0,
        }),
        prepareRetrievalSupport: jest.fn().mockResolvedValue({
          queryText: null,
          intent: null,
          searchQueries: [],
          imageObservations: [],
          usedForQuery: false,
          usedForImages: false,
          warnings: [],
          diagnostics: [],
        }),
        summarizeExtractedDocuments: jest.fn().mockResolvedValue({
          summariesByUrl: new Map<string, string>(),
          warnings: [],
          diagnostics: [],
        }),
        shapeEvidenceSynthesis: jest.fn().mockResolvedValue({
          synthesis: null,
          warnings: [],
          diagnostics: [],
        }),
      })
      .overrideProvider(EmbeddingServiceService)
      .useValue({
        getConfiguration: jest.fn().mockReturnValue({
          enabled: false,
          url: 'http://127.0.0.1:3002',
          modelId: 'bge-small-en-v1.5',
          dimensions: 384,
        }),
        getStatus: jest.fn().mockResolvedValue({
          enabled: false,
          configuredUrl: 'http://127.0.0.1:3002',
          ready: false,
          durationMs: 0,
        }),
        embed: jest.fn().mockResolvedValue({
          result: {
            modelId: 'bge-small-en-v1.5',
            dimensions: 384,
            normalized: true,
            inputType: 'query',
            embeddings: [],
            durationMs: 0,
          },
          diagnostics: {
            attempted: false,
            succeeded: false,
            durationMs: 0,
            attempts: 0,
            inputCount: 0,
            inputType: 'query',
            error: 'Embedding service is disabled.',
          },
        }),
      })
      .overrideProvider(EmbeddingWorkerService)
      .useValue({
        drainOnce: jest.fn().mockResolvedValue({ processed: 0, failed: 0 }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/v2/retrieval/evidence (POST)', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/retrieval/evidence')
      .set('x-correlation-id', 'e2e-retrieval')
      .send({
        requestContext: {
          callerService: 'e2e-test',
          priority: 'interactive',
          requestedAt: '2026-05-01T12:00:00Z',
        },
        query: {
          parts: [{ type: 'text', text: 'phase one local retrieval smoke' }],
          freshness: 'low',
          allowedModes: ['local_rag'],
          maxEvidenceChunks: 2,
          synthesisMode: 'brief',
        },
      })
      .expect(200);
    const body = response.body as RetrieveEvidenceResponse;

    expect(body.meta.correlationId).toBe('e2e-retrieval');
    expect(body.meta.apiVersion).toBe('v2');
    expect(body.data.normalizedQuery.retrievalMode).toBe('local_rag');
    expect(Array.isArray(body.data.evidenceChunks)).toBe(true);
  });

  it('/v2/retrieval/evidence/stream (POST)', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/retrieval/evidence/stream')
      .set('x-correlation-id', 'e2e-retrieval-stream')
      .send({
        requestContext: {
          callerService: 'e2e-test',
          priority: 'interactive',
          requestedAt: '2026-05-01T12:00:00Z',
        },
        query: {
          parts: [{ type: 'text', text: 'phase one local retrieval smoke' }],
          freshness: 'low',
          allowedModes: ['local_rag'],
          maxEvidenceChunks: 2,
          synthesisMode: 'brief',
        },
      })
      .expect(200)
      .expect('Content-Type', /text\/event-stream/);
    const events = parseSseEvents(response.text);

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'retrieval.started',
        'local.search.started',
        'local.search.completed',
        'retrieval.completed',
      ]),
    );
    expect(events.at(-1)?.type).toBe('retrieval.completed');
  });

  function parseSseEvents(text: string): Array<{ type: string }> {
    return text
      .split(/\n\n/)
      .map((block) =>
        block
          .split(/\n/)
          .find((line) => line.startsWith('data: '))
          ?.slice('data: '.length),
      )
      .filter((line): line is string => Boolean(line))
      .map((line) => JSON.parse(line) as { type: string });
  }

  it('returns a contract error envelope when correlation id is missing', async () => {
    const response = await request(app.getHttpServer())
      .post('/v2/retrieval/evidence')
      .send({
        requestContext: {
          callerService: 'e2e-test',
          priority: 'interactive',
          requestedAt: '2026-05-01T12:00:00Z',
        },
        query: {
          parts: [{ type: 'text', text: 'phase one local retrieval smoke' }],
          freshness: 'low',
          allowedModes: ['local_rag'],
        },
      })
      .expect(400);
    const body = response.body as ErrorEnvelope;

    expect(body.meta.apiVersion).toBe('v2');
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.message).toContain('x-correlation-id');
  });

  afterEach(async () => {
    await app.close();
  });
});
