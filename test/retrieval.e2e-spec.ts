import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { EmbeddingServiceService } from '../src/retrieval/embedding-service.service';
import { EmbeddingWorkerService } from '../src/retrieval/embedding-worker.service';
import { RetrievalService } from '../src/retrieval/retrieval.service';
import { attachRetrievalStreamServer } from '../src/retrieval/retrieval-stream-ws';
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
    await app.listen(0);
    attachRetrievalStreamServer(app.getHttpServer(), app.get(RetrievalService));
  });

  it('/v2/retrieval/evidence/stream (WebSocket)', async () => {
    const address = app.getHttpServer().address() as AddressInfo;
    const ws = new WebSocket(
      `ws://127.0.0.1:${address.port}/v2/retrieval/evidence/stream`,
      { headers: { 'x-correlation-id': 'e2e-retrieval-ws' } },
    );
    const events = await collectWebSocketEvents(ws, {
      type: 'retrieve_evidence',
      correlationId: 'e2e-retrieval-ws',
      request: {
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
        },
      },
    });

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

  function collectWebSocketEvents(
    ws: WebSocket,
    firstMessage: Record<string, unknown>,
  ): Promise<Array<{ type: string }>> {
    return new Promise((resolve, reject) => {
      const events: Array<{ type: string }> = [];
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('timed out waiting for retrieval WebSocket events'));
      }, 10_000);
      const cleanup = (): void => {
        clearTimeout(timer);
        ws.off('open', onOpen);
        ws.off('message', onMessage);
        ws.off('close', onClose);
        ws.off('error', onError);
      };
      const onOpen = (): void => {
        ws.send(JSON.stringify(firstMessage));
      };
      const onMessage = (raw: WebSocket.RawData): void => {
        events.push(JSON.parse(rawToString(raw)) as { type: string });
      };
      const onClose = (): void => {
        cleanup();
        resolve(events);
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };

      ws.on('open', onOpen);
      ws.on('message', onMessage);
      ws.on('close', onClose);
      ws.on('error', onError);
    });
  }

  function rawToString(raw: WebSocket.RawData): string {
    if (typeof raw === 'string') return raw;
    if (Buffer.isBuffer(raw)) return raw.toString('utf8');
    if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
    return Buffer.from(raw).toString('utf8');
  }

  afterEach(async () => {
    await app.close();
  });
});
