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
        data: {
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
      socket.emitMessage({ type: 'done', data: { finishReason: 'stop' } });
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
      'ws://127.0.0.1:3213/v2/infer/stream',
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
      socket.emitMessage({ type: 'chunk', data: { text: 'not json' } });
      socket.emitMessage({ type: 'done', data: { finishReason: 'stop' } });
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

  it('returns model-host status through the HTTP status endpoint', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        data: {
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
      }),
    } as never);

    const status = await makeService().getStatus('test-correlation');

    expect(status.ready).toBe(true);
    expect(status.loaded).toBe(true);
    expect(status.modelId).toBe('gemma4:e4b');
  });
});
