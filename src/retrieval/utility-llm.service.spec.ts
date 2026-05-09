import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { ConfigService } from '@nestjs/config';
import { UtilityLlmService } from './utility-llm.service';

type Listener = (event: { data?: string }) => void;

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  static onSend: ((socket: FakeWebSocket, data: string) => void) | null = null;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    setTimeout(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open', {});
    }, 0);
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    FakeWebSocket.onSend?.(this, data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', {});
  }

  emitMessage(value: unknown): void {
    this.emit('message', { data: JSON.stringify(value) });
  }

  emit(type: string, event: { data?: string }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe('UtilityLlmService', () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalFetch = globalThis.fetch;

  function makeService(timeoutMs = '200') {
    const configService = {
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          UTILITY_LLM_ENABLED: 'true',
          UTILITY_LLM_HOST_URL: 'http://127.0.0.1:3213',
          UTILITY_LLM_TIMEOUT_MS: timeoutMs,
          UTILITY_LLM_RETRIES: '0',
        };

        return values[key];
      }),
    } as unknown as ConfigService;

    return new UtilityLlmService(configService);
  }

  beforeEach(() => {
    FakeWebSocket.onSend = null;
    FakeWebSocket.instances = [];
    (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    (globalThis as { WebSocket: unknown }).WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
  });

  it('collects streamed JSON retrieval support over WebSocket', async () => {
    FakeWebSocket.onSend = (socket) => {
      socket.emitMessage({ type: 'accepted' });
      socket.emitMessage({ type: 'started' });
      socket.emitMessage({
        type: 'chunk',
        correlationId: 'test-correlation',
        payload: {
          text: JSON.stringify({
            queryText: 'hybrid RAG evaluation',
            intent: 'rag-evaluation',
            searchQueries: ['hybrid RAG evaluation'],
            imageObservations: [],
            confidence: 'high',
            reason: 'Clear retrieval request.',
          }),
        },
      });
      socket.emitMessage({
        type: 'done',
        correlationId: 'test-correlation',
        payload: { finishReason: 'stop' },
      });
    };

    const result = await makeService().prepareRetrievalSupport({
      correlationId: 'test-correlation',
      queryText: 'how to evaluate RAG',
      freshness: 'low',
      allowedModes: ['local_rag', 'live_web'],
      hints: [],
      imageParts: [],
    });

    expect(result.queryText).toBe('hybrid RAG evaluation');
    expect(result.intent).toBe('rag-evaluation');
    expect(result.usedForQuery).toBe(true);
    expect(result.diagnostics[0]?.succeeded).toBe(true);
    expect(FakeWebSocket.instances[0]?.url).toBe(
      'ws://127.0.0.1:3213/v5/model',
    );
  });

  it('degrades when the WebSocket stream times out', async () => {
    FakeWebSocket.onSend = (socket) => {
      socket.emitMessage({ type: 'accepted' });
      socket.emitMessage({ type: 'started' });
    };

    const result = await makeService('5').prepareRetrievalSupport({
      correlationId: 'test-correlation',
      queryText: 'how to evaluate RAG',
      freshness: 'low',
      allowedModes: ['local_rag', 'live_web'],
      hints: [],
      imageParts: [],
    });

    expect(result.queryText).toBeNull();
    expect(result.warnings[0]?.toLowerCase()).toContain('timed out');
    expect(result.diagnostics[0]?.succeeded).toBe(false);
  });

  it('degrades when the streamed response is not usable JSON', async () => {
    FakeWebSocket.onSend = (socket) => {
      socket.emitMessage({ type: 'accepted' });
      socket.emitMessage({ type: 'started' });
      socket.emitMessage({
        type: 'chunk',
        correlationId: 'test-correlation',
        payload: { text: 'not json' },
      });
      socket.emitMessage({
        type: 'done',
        correlationId: 'test-correlation',
        payload: { finishReason: 'stop' },
      });
    };

    const result = await makeService().prepareRetrievalSupport({
      correlationId: 'test-correlation',
      queryText: 'how to evaluate RAG',
      freshness: 'low',
      allowedModes: ['local_rag', 'live_web'],
      hints: [],
      imageParts: [],
    });

    expect(result.queryText).toBeNull();
    expect(result.warnings[0]).toContain('unusable JSON');
  });

  it('requests document retention with thinking disabled', async () => {
    let sentRequest: Record<string, unknown> | null = null;

    FakeWebSocket.onSend = (socket, data) => {
      sentRequest = JSON.parse(data) as Record<string, unknown>;
      socket.emitMessage({ type: 'accepted' });
      socket.emitMessage({ type: 'started' });
      socket.emitMessage({
        type: 'chunk',
        correlationId: 'test-correlation',
        payload: {
          text: JSON.stringify({
            documents: [
              {
                index: 1,
                retention: 'durable',
                reason: 'Stable background knowledge.',
              },
            ],
            overallReason: 'The source is durable.',
          }),
        },
      });
      socket.emitMessage({
        type: 'done',
        correlationId: 'test-correlation',
        payload: { finishReason: 'stop' },
      });
    };

    const result = await makeService().decideDocumentRetention({
      correlationId: 'test-correlation',
      queryText: 'Pericles and Aspasia',
      intent: 'historical-background',
      freshness: 'low',
      documents: [
        {
          title: 'Aspasia',
          url: 'https://example.com/aspasia',
          publishedAt: null,
          excerpt: 'Aspasia was associated with Pericles in classical Athens.',
          content: 'Aspasia was associated with Pericles in classical Athens.',
        },
      ],
    });

    const payload = sentRequest?.payload as {
      request?: {
        options?: { thinking?: boolean; responseFormat?: string };
        input?: { parts?: Array<{ text?: string }> };
      };
    };

    expect(payload.request?.options?.thinking).toBe(false);
    expect(payload.request?.options?.responseFormat).toBe('json');
    expect(payload.request?.input?.parts?.[0]?.text).toContain('Document 1');
    expect(result.retentionByUrl.get('https://example.com/aspasia')).toEqual({
      retention: 'durable',
      reason: 'Stable background knowledge.',
    });
  });

  it('returns model-host status through the WebSocket endpoint', async () => {
    FakeWebSocket.onSend = (socket) => {
      socket.emitMessage({
        type: 'model.status',
        correlationId: 'test-correlation',
        payload: {
          modelId: 'gemma4:e4b',
          ready: true,
          loaded: true,
          capabilities: {
            textInput: true,
            imageInput: true,
            textOutput: true,
            imageOutput: false,
          },
          capacity: {
            activeRequests: 0,
            modelSlots: 1,
            queueDepth: 0,
          },
        },
      });
    };

    const status = await makeService().getStatus('test-correlation');

    expect(status.ready).toBe(true);
    expect(status.loaded).toBe(true);
    expect(status.modelId).toBe('gemma4:e4b');
  });
});
