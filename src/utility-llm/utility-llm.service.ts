import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { serviceRuntimeConfig } from '../config/service-config';

function rawToString(raw: WebSocket.RawData): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface UtilityLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface UtilityContextWindow {
  numCtx: number;
  promptBudgetTokens: number;
  responseReserveTokens: number;
  promptBudgetFraction: number;
}

interface RawLlmEnvelope {
  type?: string;
  correlationId?: string;
  payload?: unknown;
  error?: { code?: string; message?: string; retryable?: boolean };
}

interface PendingInferRequest {
  text: string;
  idleTimer: NodeJS.Timeout;
  resetIdleTimer: () => void;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
}

@Injectable()
export class UtilityLlmService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(UtilityLlmService.name);
  private readonly baseUrl = (
    process.env.UTILITY_LLM_HOST_URL ?? serviceRuntimeConfig.utilityLlm.hostUrl
  ).replace(/\/$/, '');
  private readonly timeoutMs =
    Number.parseInt(
      process.env.UTILITY_LLM_TIMEOUT_MS ??
        String(serviceRuntimeConfig.utilityLlm.timeoutMs),
      10,
    ) || serviceRuntimeConfig.utilityLlm.timeoutMs;
  private readonly enabled =
    (process.env.UTILITY_LLM_ENABLED ??
      String(serviceRuntimeConfig.utilityLlm.enabled)) !== 'false';

  private ws?: WebSocket;
  private connecting?: Promise<void>;
  private reconnectTimer?: NodeJS.Timeout;
  private closing = false;
  private readonly pending = new Map<string, PendingInferRequest>();

  private cachedContextWindow: UtilityContextWindow | null = null;
  private cachedModelId: string | null = null;

  onModuleInit(): void {
    if (!this.enabled) {
      this.log.warn('UtilityLlmService disabled by config — distillation will be skipped.');
      return;
    }
    void this.connect().catch((err: Error) => {
      this.log.warn(
        `Utility LLM persistent socket unavailable at startup (${this.baseUrl}): ${err.message}`,
      );
    });
    void this.refreshModelStatus().catch((err: Error) => {
      this.log.warn(`Could not fetch utility model info at startup: ${err.message}`);
    });
  }

  onModuleDestroy(): void {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.failAll(new Error('UtilityLlmService shutting down'));
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = undefined;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getCachedContextWindow(): UtilityContextWindow | null {
    return this.cachedContextWindow;
  }

  getCachedModelId(): string | null {
    return this.cachedModelId;
  }

  async refreshModelStatus(): Promise<{
    modelId: string;
    contextWindow: UtilityContextWindow | null;
  }> {
    const wsUrl = this.streamUrl();
    const correlationId = randomUUID();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error('utility model.status timeout'));
      }, this.timeoutMs);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'model.status', correlationId }));
      });
      ws.on('message', (raw) => {
        try {
          const env = JSON.parse(rawToString(raw)) as RawLlmEnvelope;
          if (env.correlationId !== correlationId) return;
          clearTimeout(timer);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          if (env.type === 'error') {
            reject(new Error(env.error?.message ?? 'model.status failed'));
            return;
          }
          if (!isRecord(env.payload)) {
            reject(new Error('model.status returned no payload'));
            return;
          }
          const modelId =
            typeof env.payload.modelId === 'string' ? env.payload.modelId : '';
          const cwRaw = isRecord(env.payload.contextWindow)
            ? env.payload.contextWindow
            : null;
          let contextWindow: UtilityContextWindow | null = null;
          if (
            cwRaw !== null &&
            typeof cwRaw.numCtx === 'number' &&
            typeof cwRaw.promptBudgetTokens === 'number' &&
            typeof cwRaw.responseReserveTokens === 'number' &&
            typeof cwRaw.promptBudgetFraction === 'number'
          ) {
            contextWindow = {
              numCtx: cwRaw.numCtx,
              promptBudgetTokens: cwRaw.promptBudgetTokens,
              responseReserveTokens: cwRaw.responseReserveTokens,
              promptBudgetFraction: cwRaw.promptBudgetFraction,
            };
          }
          this.cachedModelId = modelId;
          this.cachedContextWindow = contextWindow;
          this.log.log(
            `Utility model resolved: ${modelId}` +
              (contextWindow
                ? `, numCtx=${contextWindow.numCtx}, promptBudgetTokens=${contextWindow.promptBudgetTokens}`
                : ', contextWindow=unknown'),
          );
          resolve({ modelId, contextWindow });
        } catch (err) {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
      ws.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Run a non-streaming inference on the utility LLM. Returns the full
   * concatenated text once the host emits `done`. The `idleTimeoutMs`
   * fires only when no event has arrived from the host for that long
   * — long-but-progressing calls (large distillation prompts) stay
   * alive as chunks stream in, and only a genuine stall terminates.
   */
  async infer(args: {
    messages: UtilityLlmMessage[];
    correlationId?: string;
    idleTimeoutMs?: number;
  }): Promise<string> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('UtilityLlmService is disabled.');
    }
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new ServiceUnavailableException(
        'Utility LLM persistent socket unavailable',
      );
    }
    const correlationId = args.correlationId ?? randomUUID();
    const idleTimeoutMs = args.idleTimeoutMs ?? this.timeoutMs;

    return new Promise<string>((resolve, reject) => {
      if (this.pending.has(correlationId)) {
        reject(
          new ServiceUnavailableException(
            `Utility LLM request ${correlationId} is already pending`,
          ),
        );
        return;
      }
      let idleTimer: NodeJS.Timeout = setTimeout(() => {
        this.sendCancel(correlationId);
        this.rejectPending(
          correlationId,
          new ServiceUnavailableException(
            `Utility LLM idle timeout (${idleTimeoutMs}ms with no chunks)`,
          ),
        );
      }, idleTimeoutMs);
      const resetIdleTimer = (): void => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          this.sendCancel(correlationId);
          this.rejectPending(
            correlationId,
            new ServiceUnavailableException(
              `Utility LLM idle timeout (${idleTimeoutMs}ms with no chunks)`,
            ),
          );
        }, idleTimeoutMs);
        const pending = this.pending.get(correlationId);
        if (pending) pending.idleTimer = idleTimer;
      };

      this.pending.set(correlationId, {
        text: '',
        idleTimer,
        resetIdleTimer,
        resolve,
        reject,
      });

      const request = {
        requestContext: {
          callerService: 'swirlock-rag-engine',
          requestedAt: new Date().toISOString(),
        },
        input: { messages: args.messages },
      };

      try {
        ws.send(
          JSON.stringify({
            type: 'infer',
            correlationId,
            payload: { request },
          }),
        );
      } catch (error) {
        this.rejectPending(
          correlationId,
          error instanceof Error ? error : new Error('Utility LLM send failed'),
        );
      }
    });
  }

  private async connect(): Promise<void> {
    if (!this.enabled) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;

    this.closing = false;
    const wsUrl = this.streamUrl();

    this.connecting = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      let settled = false;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const timer = setTimeout(() => {
        settle(() => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          reject(new Error('Utility LLM persistent socket connect timeout'));
        });
      }, this.timeoutMs);

      ws.on('open', () => {
        this.ws = ws;
        this.attachSocketHandlers(ws);
        settle(resolve);
      });
      ws.on('error', (err: Error) => settle(() => reject(err)));
      ws.on('close', () =>
        settle(() => reject(new Error('Utility LLM socket closed during connect'))),
      );
    }).finally(() => {
      this.connecting = undefined;
    });

    return this.connecting;
  }

  private attachSocketHandlers(ws: WebSocket): void {
    ws.on('message', (raw: WebSocket.RawData) => this.handleMessage(raw));
    ws.on('error', (err: Error) =>
      this.log.error(`Utility LLM WS error: ${err.message}`),
    );
    ws.on('close', () => {
      if (this.ws === ws) this.ws = undefined;
      this.failAll(new Error('Utility LLM persistent socket closed'));
      this.scheduleReconnect();
    });
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let env: RawLlmEnvelope;
    try {
      env = JSON.parse(rawToString(raw)) as RawLlmEnvelope;
    } catch {
      this.log.warn('Utility LLM emitted non-JSON message');
      return;
    }
    const correlationId =
      typeof env.correlationId === 'string' ? env.correlationId : '';
    if (!correlationId) return;
    const pending = this.pending.get(correlationId);
    if (!pending) return;
    const payload = isRecord(env.payload) ? env.payload : {};

    // Any event from the host counts as liveness — reset idle timer.
    pending.resetIdleTimer();

    if (env.type === 'chunk' && typeof payload.text === 'string') {
      pending.text += payload.text;
      return;
    }
    if (env.type === 'done') {
      this.resolvePending(correlationId, pending.text);
      return;
    }
    if (env.type === 'error') {
      this.rejectPending(
        correlationId,
        new ServiceUnavailableException(
          env.error?.message ?? 'Utility LLM stream error',
        ),
      );
    }
  }

  private sendCancel(correlationId: string): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'cancel', correlationId }));
    } catch {
      /* ignore */
    }
  }

  private resolvePending(correlationId: string, text: string): void {
    const pending = this.pending.get(correlationId);
    if (!pending) return;
    this.pending.delete(correlationId);
    clearTimeout(pending.idleTimer);
    pending.resolve(text);
  }

  private rejectPending(correlationId: string, error: Error): void {
    const pending = this.pending.get(correlationId);
    if (!pending) return;
    this.pending.delete(correlationId);
    clearTimeout(pending.idleTimer);
    pending.reject(error);
  }

  private failAll(error: Error): void {
    for (const [correlationId, pending] of this.pending) {
      this.pending.delete(correlationId);
      clearTimeout(pending.idleTimer);
      pending.reject(new ServiceUnavailableException(error.message));
    }
  }

  private scheduleReconnect(): void {
    if (this.closing || this.reconnectTimer || !this.enabled) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((err: Error) => {
        this.log.warn(
          `Utility LLM reconnect failed (${this.baseUrl}): ${err.message}`,
        );
        this.scheduleReconnect();
      });
    }, 2000);
  }

  private streamUrl(): string {
    return (
      this.baseUrl
        .replace(/^http:/i, 'ws:')
        .replace(/^https:/i, 'wss:')
        .replace(/\/$/, '') + '/v5/model'
    );
  }
}
