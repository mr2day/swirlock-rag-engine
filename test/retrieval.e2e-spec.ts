import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import type { ErrorEnvelope } from '../src/common/api-envelope';
import { AppModule } from './../src/app.module';
import type { RetrieveEvidenceResponse } from '../src/retrieval/retrieval.types';

describe('RetrievalController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
