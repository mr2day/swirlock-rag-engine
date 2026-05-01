import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { serviceRuntimeConfig } from '../config/service-config';
import type { ImageInputPart } from './retrieval.types';
import type {
  UtilityLlmCallDiagnostics,
  UtilityLlmEvidenceSynthesis,
  UtilityLlmEvidenceSynthesisInput,
  UtilityLlmExtractionSummaries,
  UtilityLlmExtractionSummariesInput,
  UtilityLlmRetrievalSupport,
  UtilityLlmRetrievalSupportInput,
  UtilityLlmStatus,
} from './utility-llm.types';

type StreamEvent =
  | { type: 'accepted' | 'started'; meta?: Record<string, unknown> }
  | { type: 'queued'; meta?: Record<string, unknown>; data?: unknown }
  | {
      type: 'thinking';
      meta?: Record<string, unknown>;
      data?: { text?: string };
    }
  | { type: 'chunk'; meta?: Record<string, unknown>; data?: { text?: string } }
  | {
      type: 'done';
      meta?: Record<string, unknown>;
      data?: { finishReason?: string };
    }
  | {
      type: 'error';
      meta?: Record<string, unknown>;
      error?: {
        code?: string;
        message?: string;
        retryable?: boolean;
        details?: Record<string, unknown>;
      };
    };

interface StreamInferOptions {
  correlationId: string;
  task: string;
  prompt: string;
  imageParts?: ImageInputPart[];
  responseFormat?: 'text' | 'json';
  temperature?: number;
  priority?: number;
}

interface StreamInferResult {
  text: string;
  diagnostics: UtilityLlmCallDiagnostics;
}

@Injectable()
export class UtilityLlmService {
  private readonly logger = new Logger(UtilityLlmService.name);

  constructor(private readonly configService: ConfigService) {}

  getConfiguration(): Pick<UtilityLlmStatus, 'enabled' | 'configuredUrl'> {
    return {
      enabled: this.enabled,
      configuredUrl: this.hostUrl,
    };
  }

  async getStatus(correlationId: string): Promise<UtilityLlmStatus> {
    const startedAt = Date.now();

    if (!this.enabled) {
      return {
        enabled: false,
        configuredUrl: this.hostUrl,
        ready: false,
        durationMs: Date.now() - startedAt,
      };
    }

    try {
      const response = await this.fetchWithTimeout(
        this.statusUrl,
        {
          headers: {
            'x-correlation-id': correlationId,
          },
        },
        this.timeoutMs,
      );
      const payload = (await response.json()) as unknown;

      if (!response.ok || !isRecord(payload) || !isRecord(payload.data)) {
        return {
          enabled: true,
          configuredUrl: this.hostUrl,
          ready: false,
          error: `Utility LLM Host status request failed with HTTP ${response.status}.`,
          durationMs: Date.now() - startedAt,
        };
      }

      const data = payload.data;
      const capabilities = normalizeModelCapabilities(data.capabilities);
      const capacity = normalizeModelCapacity(data.capacity);

      return {
        enabled: true,
        configuredUrl: this.hostUrl,
        ready: data.ready === true,
        loaded: typeof data.loaded === 'boolean' ? data.loaded : undefined,
        modelId: typeof data.modelId === 'string' ? data.modelId : undefined,
        capabilities,
        capacity,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        enabled: true,
        configuredUrl: this.hostUrl,
        ready: false,
        error: this.getErrorMessage(error),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  async prepareRetrievalSupport(
    input: UtilityLlmRetrievalSupportInput,
  ): Promise<UtilityLlmRetrievalSupport> {
    const diagnostics: UtilityLlmCallDiagnostics[] = [];
    const warnings: string[] = [];
    const resolvableImageParts = input.imageParts.filter((part) =>
      Boolean(part.imageUrl),
    );
    const unresolvedImageParts = input.imageParts.filter((part) =>
      Boolean(part.imageId),
    );

    if (unresolvedImageParts.length > 0) {
      warnings.push(
        `${unresolvedImageParts.length} imageId reference(s) could not be sent to the Utility LLM Host because RAG does not have a media resolver yet.`,
      );
    }

    if (
      !this.enabled ||
      (!input.queryText.trim() && resolvableImageParts.length === 0)
    ) {
      return {
        queryText: null,
        intent: null,
        searchQueries: [],
        imageObservations: [],
        usedForQuery: false,
        usedForImages: false,
        warnings,
        diagnostics: [
          this.skippedDiagnostic(
            'retrieval_support',
            this.enabled
              ? 'No text query or resolvable image reference was available.'
              : 'Utility LLM Host support is disabled.',
          ),
        ],
      };
    }

    const prompt = this.buildRetrievalSupportPrompt(
      input,
      resolvableImageParts,
    );
    const result = await this.safeInferJson(
      {
        correlationId: input.correlationId,
        task: 'retrieval_support',
        prompt,
        imageParts: resolvableImageParts,
        responseFormat: 'json',
        temperature: 0,
        priority: this.priorityForTask('interactive'),
      },
      (value) => this.normalizeRetrievalSupportJson(value),
    );

    diagnostics.push(result.diagnostics);

    if (!result.value) {
      warnings.push(result.warning);
      return {
        queryText: null,
        intent: null,
        searchQueries: [],
        imageObservations: [],
        usedForQuery: false,
        usedForImages: false,
        warnings,
        diagnostics,
      };
    }

    return {
      queryText: result.value.queryText,
      intent: result.value.intent,
      searchQueries: result.value.searchQueries,
      imageObservations: result.value.imageObservations,
      usedForQuery: Boolean(result.value.queryText || result.value.intent),
      usedForImages:
        resolvableImageParts.length > 0 &&
        result.value.imageObservations.length > 0,
      warnings,
      diagnostics,
    };
  }

  async summarizeExtractedDocuments(
    input: UtilityLlmExtractionSummariesInput,
  ): Promise<UtilityLlmExtractionSummaries> {
    if (!this.enabled || input.documents.length === 0) {
      return {
        summariesByUrl: new Map(),
        warnings: [],
        diagnostics: [
          this.skippedDiagnostic(
            'extraction_summaries',
            this.enabled
              ? 'No extracted documents were available.'
              : 'Utility LLM Host support is disabled.',
          ),
        ],
      };
    }

    const result = await this.safeInferJson(
      {
        correlationId: input.correlationId,
        task: 'extraction_summaries',
        prompt: this.buildExtractionSummariesPrompt(input),
        responseFormat: 'json',
        temperature: 0,
        priority: this.priorityForTask('background'),
      },
      (value) => this.normalizeExtractionSummariesJson(value),
    );

    if (!result.value) {
      return {
        summariesByUrl: new Map(),
        warnings: [result.warning],
        diagnostics: [result.diagnostics],
      };
    }

    return {
      summariesByUrl: result.value,
      warnings: [],
      diagnostics: [result.diagnostics],
    };
  }

  async shapeEvidenceSynthesis(
    input: UtilityLlmEvidenceSynthesisInput,
  ): Promise<UtilityLlmEvidenceSynthesis> {
    if (!this.enabled || input.evidenceChunks.length === 0) {
      return {
        synthesis: null,
        warnings: [],
        diagnostics: [
          this.skippedDiagnostic(
            'evidence_synthesis',
            this.enabled
              ? 'No evidence chunks were available.'
              : 'Utility LLM Host support is disabled.',
          ),
        ],
      };
    }

    const result = await this.safeInferJson(
      {
        correlationId: input.correlationId,
        task: 'evidence_synthesis',
        prompt: this.buildEvidenceSynthesisPrompt(input),
        responseFormat: 'json',
        temperature: 0.1,
        priority: this.priorityForTask('background'),
      },
      (value) => this.normalizeEvidenceSynthesisJson(value),
    );

    if (!result.value) {
      return {
        synthesis: null,
        warnings: [result.warning],
        diagnostics: [result.diagnostics],
      };
    }

    return {
      synthesis: result.value,
      warnings: [],
      diagnostics: [result.diagnostics],
    };
  }

  private async safeInferJson<T>(
    options: StreamInferOptions,
    normalize: (value: unknown) => T | null,
  ): Promise<{
    value: T | null;
    warning: string;
    diagnostics: UtilityLlmCallDiagnostics;
  }> {
    try {
      const result = await this.streamInfer(options);
      const parsed = parseJsonObject(result.text);
      const value = normalize(parsed);

      if (!value) {
        return {
          value: null,
          warning: `Utility LLM Host returned unusable JSON for ${options.task}.`,
          diagnostics: {
            ...result.diagnostics,
            succeeded: false,
            error: 'Response JSON did not match the expected shape.',
          },
        };
      }

      return {
        value,
        warning: '',
        diagnostics: result.diagnostics,
      };
    } catch (error) {
      const message = this.getErrorMessage(error);

      this.logger.warn(`[utility-llm] ${options.task} failed: ${message}`);

      return {
        value: null,
        warning: `Utility LLM Host ${options.task} failed: ${message}`,
        diagnostics: {
          task: options.task,
          attempted: true,
          succeeded: false,
          durationMs: 0,
          attempts: this.maxAttempts,
          error: message,
        },
      };
    }
  }

  private async streamInfer(
    options: StreamInferOptions,
  ): Promise<StreamInferResult> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const startedAt = Date.now();

      try {
        const text = await this.streamInferOnce(options);

        return {
          text,
          diagnostics: {
            task: options.task,
            attempted: true,
            succeeded: true,
            durationMs: Date.now() - startedAt,
            attempts: attempt,
          },
        };
      } catch (error) {
        lastError = error;

        if (!isRetryableUtilityError(error) || attempt >= this.maxAttempts) {
          throw error;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Utility LLM Host request failed.');
  }

  private streamInferOnce(options: StreamInferOptions): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.streamUrl);
      let settled = false;
      let completed = false;
      let output = '';
      const timeout = setTimeout(() => {
        finish(
          new UtilityLlmError(
            `Timed out after ${this.timeoutMs}ms waiting for Utility LLM Host.`,
            true,
          ),
        );
      }, this.timeoutMs);

      const finish = (error: Error | null, value = '') => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);

        if (
          socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING
        ) {
          socket.close();
        }

        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };

      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            type: 'infer',
            correlationId: options.correlationId,
            request: {
              requestContext: {
                callerService: serviceRuntimeConfig.serviceName,
                priority: options.priority,
                requestedAt: new Date().toISOString(),
              },
              input: {
                parts: [
                  { type: 'text', text: options.prompt },
                  ...this.toModelHostImageParts(options.imageParts ?? []),
                ],
              },
              options: {
                responseFormat: options.responseFormat ?? 'json',
                thinking: false,
                ollama: {
                  temperature: options.temperature ?? 0,
                },
              },
            },
          }),
        );
      });

      socket.addEventListener('message', (event) => {
        const message = this.parseStreamEvent(event.data);

        if (!message) {
          finish(
            new UtilityLlmError(
              'Utility LLM Host sent a malformed WebSocket event.',
              true,
            ),
          );
          return;
        }

        if (message.type === 'chunk') {
          output += message.data?.text ?? '';
          return;
        }

        if (message.type === 'error') {
          finish(
            new UtilityLlmError(
              message.error?.message || 'Utility LLM Host inference failed.',
              message.error?.retryable !== false,
            ),
          );
          return;
        }

        if (message.type === 'done') {
          completed = true;
          finish(null, output);
        }
      });

      socket.addEventListener('error', () => {
        finish(new UtilityLlmError('Utility LLM Host WebSocket failed.', true));
      });

      socket.addEventListener('close', () => {
        if (!completed && !settled) {
          finish(
            new UtilityLlmError(
              'Utility LLM Host WebSocket closed before completion.',
              true,
            ),
          );
        }
      });
    });
  }

  private toModelHostImageParts(
    imageParts: ImageInputPart[],
  ): Array<{ type: 'image'; imageUrl: string; mimeType?: string }> {
    return imageParts
      .filter((part): part is ImageInputPart & { imageUrl: string } =>
        Boolean(part.imageUrl),
      )
      .map((part) => ({
        type: 'image',
        imageUrl: part.imageUrl,
        ...(part.mimeType ? { mimeType: part.mimeType } : {}),
      }));
  }

  private parseStreamEvent(value: unknown): StreamEvent | null {
    const text =
      typeof value === 'string'
        ? value
        : value instanceof Buffer
          ? value.toString('utf8')
          : typeof (value as { toString?: unknown })?.toString === 'function'
            ? String(value)
            : '';

    try {
      const parsed = JSON.parse(text) as unknown;

      return isRecord(parsed) && typeof parsed.type === 'string'
        ? (parsed as StreamEvent)
        : null;
    } catch {
      return null;
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildRetrievalSupportPrompt(
    input: UtilityLlmRetrievalSupportInput,
    imageParts: ImageInputPart[],
  ): string {
    return [
      'You are retrieval support for the Swirlock RAG Engine.',
      'Return JSON only. Do not answer the user.',
      'The RAG Engine owns retrieval decisions; you only provide support data.',
      '',
      'Schema:',
      '{"queryText": string|null, "intent": string|null, "searchQueries": string[], "imageObservations": string[], "confidence": "low"|"medium"|"high", "reason": string}',
      '',
      'Rules:',
      '- queryText should be a concise web/search query when useful.',
      '- intent should be a short retrieval intent label.',
      '- searchQueries should contain up to 3 search-engine-ready queries.',
      '- imageObservations should contain visible facts only, no speculation.',
      '- Use null for queryText when no searchable query can be derived.',
      '',
      `Original text query: ${input.queryText || '(none)'}`,
      `Caller intent: ${input.intent || '(none)'}`,
      `Freshness: ${input.freshness}`,
      `Allowed modes: ${input.allowedModes.join(', ') || '(none)'}`,
      `Hints: ${JSON.stringify(input.hints)}`,
      `Image URLs attached for inspection: ${imageParts.length}`,
    ].join('\n');
  }

  private buildExtractionSummariesPrompt(
    input: UtilityLlmExtractionSummariesInput,
  ): string {
    return [
      'You are summarizing extracted web documents for a retrieval cache.',
      'Return JSON only. Keep summaries factual and source-grounded.',
      '',
      'Schema:',
      '{"summaries": [{"url": string, "summary": string}]}',
      '',
      `Retrieval query: ${input.queryText}`,
      `Intent: ${input.intent}`,
      '',
      'Documents:',
      JSON.stringify(
        input.documents.slice(0, 6).map((document) => ({
          title: document.title,
          url: document.url,
          publishedAt: document.publishedAt,
          excerpt: limitText(document.excerpt || document.content, 1200),
        })),
      ),
    ].join('\n');
  }

  private buildEvidenceSynthesisPrompt(
    input: UtilityLlmEvidenceSynthesisInput,
  ): string {
    return [
      'You are shaping retrieval evidence for downstream context assembly.',
      'Return JSON only. Do not produce a final user answer.',
      '',
      'Schema:',
      '{"summary": string, "confidence": "low"|"medium"|"high", "caveats": string[]}',
      '',
      `Synthesis mode: ${input.synthesisMode}`,
      `Retrieval query: ${input.queryText}`,
      `Existing caveats: ${JSON.stringify(input.caveats)}`,
      '',
      'Evidence chunks:',
      JSON.stringify(
        input.evidenceChunks.slice(0, 8).map((chunk) => ({
          sourceType: chunk.sourceType,
          sourceTitle: chunk.sourceTitle,
          sourceUrl: chunk.sourceUrl,
          relevanceScore: chunk.relevanceScore,
          freshnessScore: chunk.freshnessScore,
          publishedAt: chunk.publishedAt,
          content: limitText(chunk.content, 1000),
        })),
      ),
    ].join('\n');
  }

  private normalizeRetrievalSupportJson(value: unknown): {
    queryText: string | null;
    intent: string | null;
    searchQueries: string[];
    imageObservations: string[];
  } | null {
    if (!isRecord(value)) {
      return null;
    }

    const confidence =
      typeof value.confidence === 'string' ? value.confidence : 'medium';

    return {
      queryText:
        confidence !== 'low'
          ? normalizeOptionalString(value.queryText, 280)
          : null,
      intent: normalizeOptionalString(value.intent, 80),
      searchQueries: normalizeStringArray(value.searchQueries, 3, 280),
      imageObservations: normalizeStringArray(value.imageObservations, 8, 500),
    };
  }

  private normalizeExtractionSummariesJson(
    value: unknown,
  ): Map<string, string> | null {
    if (!isRecord(value) || !Array.isArray(value.summaries)) {
      return null;
    }

    const summariesByUrl = new Map<string, string>();

    for (const item of value.summaries) {
      if (!isRecord(item)) {
        continue;
      }

      const url = normalizeOptionalString(item.url, 1000);
      const summary = normalizeOptionalString(item.summary, 1200);

      if (url && summary) {
        summariesByUrl.set(url, summary);
      }
    }

    return summariesByUrl;
  }

  private normalizeEvidenceSynthesisJson(
    value: unknown,
  ): UtilityLlmEvidenceSynthesis['synthesis'] {
    if (!isRecord(value)) {
      return null;
    }

    const summary = normalizeOptionalString(value.summary, 1800);
    const confidence =
      value.confidence === 'high' ||
      value.confidence === 'medium' ||
      value.confidence === 'low'
        ? value.confidence
        : 'medium';

    if (!summary) {
      return null;
    }

    return {
      summary,
      confidence,
      caveats: normalizeStringArray(value.caveats, 6, 500),
    };
  }

  private priorityForTask(kind: 'interactive' | 'background'): number {
    return kind === 'interactive' ? 10 : 0;
  }

  private skippedDiagnostic(
    task: string,
    reason: string,
  ): UtilityLlmCallDiagnostics {
    return {
      task,
      attempted: false,
      succeeded: false,
      durationMs: 0,
      attempts: 0,
      error: reason,
    };
  }

  private get enabled(): boolean {
    return parseBoolean(
      this.configService.get<string>('UTILITY_LLM_ENABLED'),
      serviceRuntimeConfig.utilityLlm.enabled,
    );
  }

  private get hostUrl(): string {
    return (
      this.configService.get<string>('UTILITY_LLM_HOST_URL') ||
      serviceRuntimeConfig.utilityLlm.hostUrl
    ).replace(/\/+$/, '');
  }

  private get timeoutMs(): number {
    return parsePositiveInteger(
      this.configService.get<string>('UTILITY_LLM_TIMEOUT_MS'),
      serviceRuntimeConfig.utilityLlm.timeoutMs,
    );
  }

  private get retries(): number {
    return Math.max(
      0,
      parsePositiveInteger(
        this.configService.get<string>('UTILITY_LLM_RETRIES'),
        serviceRuntimeConfig.utilityLlm.retries,
      ),
    );
  }

  private get maxAttempts(): number {
    return this.retries + 1;
  }

  private get statusUrl(): string {
    return new URL('/v2/model/status', this.hostUrl).toString();
  }

  private get streamUrl(): string {
    const url = new URL('/v2/infer/stream', this.hostUrl);

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    return url.toString();
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

class UtilityLlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'UtilityLlmError';
  }
}

function isRetryableUtilityError(error: unknown): boolean {
  return error instanceof UtilityLlmError ? error.retryable : true;
}

function parseJsonObject(value: string): unknown {
  const trimmed = value.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function normalizeOptionalString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return null;
  }

  return limitText(normalized, maxLength);
}

function normalizeStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map((item) => normalizeOptionalString(item, maxLength))
        .filter((item): item is string => Boolean(item)),
    ),
  ].slice(0, maxItems);
}

function limitText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
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

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeModelCapabilities(
  value: unknown,
): UtilityLlmStatus['capabilities'] {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.textInput !== 'boolean' ||
    typeof value.imageInput !== 'boolean' ||
    typeof value.textOutput !== 'boolean' ||
    typeof value.imageOutput !== 'boolean'
  ) {
    return undefined;
  }

  return {
    textInput: value.textInput,
    imageInput: value.imageInput,
    textOutput: value.textOutput,
    imageOutput: value.imageOutput,
  };
}

function normalizeModelCapacity(value: unknown): UtilityLlmStatus['capacity'] {
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
