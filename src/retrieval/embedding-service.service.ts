import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { serviceRuntimeConfig } from '../config/service-config';
import type {
  EmbeddingCallDiagnostics,
  EmbeddingInputType,
  EmbeddingResult,
  EmbeddingServiceStatus,
} from './embedding-service.types';

const FETCH_TIMEOUT_MARGIN_MS = 250;

@Injectable()
export class EmbeddingServiceService {
  private readonly logger = new Logger(EmbeddingServiceService.name);

  constructor(private readonly configService: ConfigService) {}

  getConfiguration(): {
    enabled: boolean;
    url: string;
    modelId: string;
    dimensions: number;
  } {
    return {
      enabled: this.enabled,
      url: this.url,
      modelId: this.modelId,
      dimensions: this.dimensions,
    };
  }

  async embed(
    correlationId: string,
    texts: string[],
    inputType: EmbeddingInputType,
  ): Promise<{
    result: EmbeddingResult;
    diagnostics: EmbeddingCallDiagnostics;
  }> {
    const trimmed = texts
      .map((value) => (typeof value === 'string' ? value : String(value ?? '')))
      .filter((value) => value.length > 0);
    const startedAt = Date.now();

    if (!this.enabled) {
      return {
        result: this.emptyResult(inputType, startedAt),
        diagnostics: {
          attempted: false,
          succeeded: false,
          durationMs: 0,
          attempts: 0,
          inputCount: trimmed.length,
          inputType,
          error: 'Embedding service is disabled.',
        },
      };
    }

    if (trimmed.length === 0) {
      return {
        result: this.emptyResult(inputType, startedAt),
        diagnostics: {
          attempted: false,
          succeeded: false,
          durationMs: 0,
          attempts: 0,
          inputCount: 0,
          inputType,
          error: 'No non-empty texts to embed.',
        },
      };
    }

    let attempts = 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      attempts += 1;

      try {
        const response = await this.callEmbed(
          correlationId,
          trimmed,
          inputType,
        );

        return {
          result: response,
          diagnostics: {
            attempted: true,
            succeeded: true,
            durationMs: Date.now() - startedAt,
            attempts,
            inputCount: trimmed.length,
            inputType,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.retries && isRetryable(error)) {
          continue;
        }

        break;
      }
    }

    return {
      result: this.emptyResult(inputType, startedAt),
      diagnostics: {
        attempted: true,
        succeeded: false,
        durationMs: Date.now() - startedAt,
        attempts,
        inputCount: trimmed.length,
        inputType,
        error: lastError?.message ?? 'Unknown embedding service error.',
      },
    };
  }

  async getStatus(correlationId: string): Promise<EmbeddingServiceStatus> {
    const startedAt = Date.now();

    if (!this.enabled) {
      return {
        enabled: false,
        configuredUrl: this.url,
        ready: false,
        durationMs: Date.now() - startedAt,
      };
    }

    try {
      const response = await this.fetchWithTimeout(
        new URL('/v2/model/status', this.url).toString(),
        {
          method: 'GET',
          headers: { 'x-correlation-id': correlationId },
        },
        this.timeoutMs,
      );

      const payload = (await response.json()) as unknown;

      if (!response.ok || !isRecord(payload) || !isRecord(payload.data)) {
        return {
          enabled: true,
          configuredUrl: this.url,
          ready: false,
          error: `Embedding service status request failed with HTTP ${response.status}.`,
          durationMs: Date.now() - startedAt,
        };
      }

      const data = payload.data;
      const capabilities = isRecord(data.capabilities) ? data.capabilities : {};
      const capacity = normalizeCapacity(data.capacity);

      return {
        enabled: true,
        configuredUrl: this.url,
        ready: data.ready === true,
        modelId: typeof data.modelId === 'string' ? data.modelId : undefined,
        dimensions:
          typeof capabilities.dimensions === 'number'
            ? capabilities.dimensions
            : undefined,
        normalizedByDefault:
          typeof capabilities.normalizesByDefault === 'boolean'
            ? capabilities.normalizesByDefault
            : undefined,
        capacity,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        enabled: true,
        configuredUrl: this.url,
        ready: false,
        error: getErrorMessage(error),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private async callEmbed(
    correlationId: string,
    texts: string[],
    inputType: EmbeddingInputType,
  ): Promise<EmbeddingResult> {
    const startedAt = Date.now();
    const requestBody = {
      requestContext: {
        callerService: serviceRuntimeConfig.serviceName,
        requestedAt: new Date().toISOString(),
        priority: inputType === 'query' ? 100 : 0,
      },
      input: { texts },
      options: {
        normalize: true,
        inputType,
      },
    };

    const response = await this.fetchWithTimeout(
      new URL('/v2/embeddings', this.url).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-correlation-id': correlationId,
        },
        body: JSON.stringify(requestBody),
      },
      this.timeoutMs,
    );

    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok || !isRecord(payload) || !isRecord(payload.data)) {
      const message = readErrorMessage(payload, response.status);
      const retryable =
        response.status >= 500 ||
        response.status === 408 ||
        response.status === 429;
      throw new EmbeddingServiceError(message, retryable);
    }

    const data = payload.data;

    if (!Array.isArray(data.embeddings)) {
      throw new EmbeddingServiceError(
        'Embedding response missing embeddings array.',
        false,
      );
    }

    const rawEmbeddings: unknown[] = data.embeddings;

    if (rawEmbeddings.length !== texts.length) {
      throw new EmbeddingServiceError(
        `Embedding response returned ${rawEmbeddings.length} vectors for ${texts.length} inputs.`,
        false,
      );
    }

    const dimensions =
      typeof data.dimensions === 'number'
        ? data.dimensions
        : Array.isArray(rawEmbeddings[0])
          ? rawEmbeddings[0].length
          : 0;

    if (dimensions <= 0) {
      throw new EmbeddingServiceError(
        'Embedding response had invalid dimensions.',
        false,
      );
    }

    if (this.dimensions > 0 && dimensions !== this.dimensions) {
      throw new EmbeddingServiceError(
        `Embedding service returned ${dimensions}-dim vectors but RAG is configured for ${this.dimensions}.`,
        false,
      );
    }

    const embeddings: number[][] = [];

    for (const [index, rawVector] of rawEmbeddings.entries()) {
      if (!Array.isArray(rawVector) || rawVector.length !== dimensions) {
        throw new EmbeddingServiceError(
          `Embedding at index ${index} did not match expected dimensions ${dimensions}.`,
          false,
        );
      }

      const vector: unknown[] = rawVector;
      const numeric: number[] = [];

      for (let position = 0; position < dimensions; position += 1) {
        const value = vector[position];

        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new EmbeddingServiceError(
            `Embedding at index ${index} contained a non-finite value.`,
            false,
          );
        }

        numeric.push(value);
      }

      embeddings.push(numeric);
    }

    return {
      modelId: typeof data.modelId === 'string' ? data.modelId : this.modelId,
      dimensions,
      normalized: data.normalized === true,
      inputType:
        data.inputType === 'query' || data.inputType === 'document'
          ? data.inputType
          : inputType,
      embeddings,
      durationMs: Date.now() - startedAt,
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      timeoutMs + FETCH_TIMEOUT_MARGIN_MS,
    );

    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') {
        throw new EmbeddingServiceError(
          `Embedding service request timed out after ${timeoutMs}ms.`,
          true,
        );
      }
      throw new EmbeddingServiceError(getErrorMessage(error), true);
    } finally {
      clearTimeout(timer);
    }
  }

  private emptyResult(
    inputType: EmbeddingInputType,
    startedAt: number,
  ): EmbeddingResult {
    return {
      modelId: this.modelId,
      dimensions: this.dimensions,
      normalized: true,
      inputType,
      embeddings: [],
      durationMs: Date.now() - startedAt,
    };
  }

  private get enabled(): boolean {
    return parseBoolean(
      this.configService.get<string>('EMBEDDING_SERVICE_ENABLED'),
      serviceRuntimeConfig.embeddingService.enabled,
    );
  }

  private get url(): string {
    return (
      this.configService.get<string>('EMBEDDING_SERVICE_URL') ||
      serviceRuntimeConfig.embeddingService.url
    ).replace(/\/+$/, '');
  }

  private get modelId(): string {
    return (
      this.configService.get<string>('EMBEDDING_SERVICE_MODEL_ID') ||
      serviceRuntimeConfig.embeddingService.modelId
    );
  }

  private get dimensions(): number {
    return parsePositiveInteger(
      this.configService.get<string>('EMBEDDING_SERVICE_DIMENSIONS'),
      serviceRuntimeConfig.embeddingService.dimensions,
    );
  }

  private get timeoutMs(): number {
    return parsePositiveInteger(
      this.configService.get<string>('EMBEDDING_SERVICE_TIMEOUT_MS'),
      serviceRuntimeConfig.embeddingService.timeoutMs,
    );
  }

  private get retries(): number {
    return parseNonNegativeInteger(
      this.configService.get<string>('EMBEDDING_SERVICE_RETRIES'),
      serviceRuntimeConfig.embeddingService.retries,
    );
  }
}

class EmbeddingServiceError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmbeddingServiceError';
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof EmbeddingServiceError ? error.retryable : true;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readErrorMessage(payload: unknown, status: number): string {
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message;
  }
  return `Embedding service responded with HTTP ${status}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCapacity(value: unknown): EmbeddingServiceStatus['capacity'] {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.activeRequests !== 'number' ||
    typeof value.modelSlots !== 'number' ||
    typeof value.queueDepth !== 'number'
  ) {
    return undefined;
  }
  return {
    activeRequests: value.activeRequests,
    modelSlots: value.modelSlots,
    queueDepth: value.queueDepth,
    averageRequestDurationMs:
      typeof value.averageRequestDurationMs === 'number'
        ? value.averageRequestDurationMs
        : undefined,
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (/^(1|true|yes|on)$/i.test(value)) {
    return true;
  }
  if (/^(0|false|no|off)$/i.test(value)) {
    return false;
  }
  return fallback;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}
