import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { serviceRuntimeConfig } from '../config/service-config';
import type { ImageInputPart } from './retrieval.types';
import type {
  UtilityLlmCallDiagnostics,
  UtilityLlmDocumentRetentionDecision,
  UtilityLlmDocumentRetentionInput,
  UtilityLlmExtractionSummaries,
  UtilityLlmExtractionSummariesInput,
  UtilityLlmRetrievalSupport,
  UtilityLlmRetrievalSupportInput,
  UtilityLlmStatus,
} from './utility-llm.types';

type StreamEvent = { correlationId?: string } & (
  | { type: 'accepted' | 'started'; payload?: Record<string, unknown> }
  | { type: 'queued'; payload?: unknown }
  | {
      type: 'thinking';
      payload?: { text?: string };
    }
  | { type: 'chunk'; payload?: { text?: string } }
  | {
      type: 'done';
      payload?: { finishReason?: string };
    }
  | {
      type: 'model.status';
      payload?: Record<string, unknown>;
    }
  | {
      type: 'error';
      error?: {
        code?: string;
        message?: string;
        retryable?: boolean;
        details?: Record<string, unknown>;
      };
    }
);

interface StreamInferOptions {
  correlationId: string;
  task: string;
  prompt: string;
  imageParts?: ImageInputPart[];
  responseFormat?: 'text' | 'json';
  temperature?: number;
  priority?: number;
  thinking?: boolean;
}

interface StreamInferResult {
  text: string;
  diagnostics: UtilityLlmCallDiagnostics;
}

interface PendingUtilityRequest {
  output: string;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

@Injectable()
export class UtilityLlmService {
  private readonly logger = new Logger(UtilityLlmService.name);
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private readonly pending = new Map<string, PendingUtilityRequest>();

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
      const payload = await this.requestPayload('model.status', correlationId);

      if (!isRecord(payload)) {
        return {
          enabled: true,
          configuredUrl: this.hostUrl,
          ready: false,
          error: 'Utility LLM Host status response was malformed.',
          durationMs: Date.now() - startedAt,
        };
      }

      const data = payload;
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

    const documents = input.documents.slice(0, 6);
    const result = await this.safeInferJson(
      {
        correlationId: input.correlationId,
        task: 'extraction_summaries',
        prompt: this.buildExtractionSummariesPrompt(
          input.queryText,
          input.intent,
          documents,
        ),
        responseFormat: 'text',
        temperature: 0,
        priority: this.priorityForTask('background'),
      },
      (value) => this.normalizeExtractionSummariesJson(value, documents),
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

  async decideDocumentRetention(
    input: UtilityLlmDocumentRetentionInput,
  ): Promise<UtilityLlmDocumentRetentionDecision> {
    if (!this.enabled || input.documents.length === 0) {
      return {
        retentionByUrl: new Map(),
        warnings: [],
        diagnostics: [
          this.skippedDiagnostic(
            'document_retention',
            this.enabled
              ? 'No extracted documents were available.'
              : 'Utility LLM Host support is disabled.',
          ),
        ],
      };
    }

    const documents = input.documents.slice(0, 6);
    const result = await this.safeInferJson(
      {
        correlationId: input.correlationId,
        task: 'document_retention',
        prompt: this.buildDocumentRetentionPrompt(
          input.queryText,
          input.intent,
          input.freshness,
          documents,
        ),
        responseFormat: 'json',
        temperature: 0,
        priority: this.priorityForTask('background'),
        thinking: false,
      },
      (value) => this.normalizeDocumentRetentionJson(value, documents),
    );

    if (!result.value) {
      return {
        retentionByUrl: new Map(),
        warnings: [result.warning],
        diagnostics: [result.diagnostics],
      };
    }

    return {
      retentionByUrl: result.value,
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
      const timeout = setTimeout(() => {
        this.pending.delete(options.correlationId);
        this.sendCancel(options.correlationId);
        reject(
          new UtilityLlmError(
            `Timed out after ${this.timeoutMs}ms waiting for Utility LLM Host.`,
            true,
          ),
        );
      }, this.timeoutMs);

      this.pending.set(options.correlationId, {
        output: '',
        timer: timeout,
        resolve,
        reject,
      });

      void this.getSocket()
        .then((socket) => {
          socket.send(
            JSON.stringify({
              type: 'infer',
              correlationId: options.correlationId,
              payload: {
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
                    thinking: options.thinking ?? false,
                    ollama: {
                      temperature: options.temperature ?? 0,
                    },
                  },
                },
              },
            }),
          );
        })
        .catch((error) => {
          const pending = this.pending.get(options.correlationId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(options.correlationId);
          reject(
            new UtilityLlmError(
              error instanceof Error ? error.message : String(error),
              true,
            ),
          );
        });
    });
  }

  private requestPayload(
    type: string,
    correlationId: string,
    payload?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(correlationId);
        this.sendCancel(correlationId);
        reject(
          new UtilityLlmError(
            `Timed out after ${this.timeoutMs}ms waiting for Utility LLM Host.`,
            true,
          ),
        );
      }, this.timeoutMs);

      this.pending.set(correlationId, {
        output: '',
        timer: timeout,
        resolve: (value) => resolve(parseJsonObject(value)),
        reject,
      });

      void this.getSocket()
        .then((socket) => {
          socket.send(
            JSON.stringify({
              type,
              correlationId,
              ...(payload ? { payload } : {}),
            }),
          );
        })
        .catch((error) => {
          const pending = this.pending.get(correlationId);
          if (!pending) return;
          clearTimeout(pending.timer);
          this.pending.delete(correlationId);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  private getSocket(): Promise<WebSocket> {
    if (this.socket?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket);
    }
    if (this.connecting) return this.connecting;

    const connecting = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.streamUrl);
      const timeout = setTimeout(() => {
        reject(new Error('Utility LLM Host WebSocket connect timeout.'));
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }, this.timeoutMs);

      socket.addEventListener('open', () => {
        clearTimeout(timeout);
        this.socket = socket;
        resolve(socket);
      });

      socket.addEventListener('message', (event) => {
        this.handleStreamEvent(event.data);
      });

      socket.addEventListener('error', () => {
        this.rejectAll(
          new UtilityLlmError('Utility LLM Host WebSocket failed.', true),
        );
      });

      socket.addEventListener('close', () => {
        if (this.socket === socket) {
          this.socket = null;
        }
        this.rejectAll(
          new UtilityLlmError(
            'Utility LLM Host WebSocket closed before completion.',
            true,
          ),
        );
      });
    }).finally(() => {
      this.connecting = null;
    });

    this.connecting = connecting;
    return connecting;
  }

  private handleStreamEvent(value: unknown): void {
    const message = this.parseStreamEvent(value);
    if (!message) {
      this.rejectAll(
        new UtilityLlmError(
          'Utility LLM Host sent a malformed WebSocket event.',
          true,
        ),
      );
      return;
    }

    const correlationId =
      isRecord(message) && typeof message.correlationId === 'string'
        ? message.correlationId
        : '';
    const pending = this.pending.get(correlationId);
    if (!pending) return;

    if (message.type === 'chunk') {
      pending.output += message.payload?.text ?? '';
      return;
    }

    if (message.type === 'error') {
      clearTimeout(pending.timer);
      this.pending.delete(correlationId);
      pending.reject(
        new UtilityLlmError(
          message.error?.message || 'Utility LLM Host inference failed.',
          message.error?.retryable !== false,
        ),
      );
      return;
    }

    if (message.type === 'model.status') {
      clearTimeout(pending.timer);
      this.pending.delete(correlationId);
      pending.resolve(JSON.stringify(message.payload ?? {}));
      return;
    }

    if (message.type === 'done') {
      clearTimeout(pending.timer);
      this.pending.delete(correlationId);
      pending.resolve(pending.output);
    }
  }

  private sendCancel(correlationId: string): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: 'cancel', correlationId }));
  }

  private rejectAll(error: Error): void {
    for (const [correlationId, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(correlationId);
      pending.reject(error);
    }
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

  private buildRetrievalSupportPrompt(
    input: UtilityLlmRetrievalSupportInput,
    imageParts: ImageInputPart[],
  ): string {
    const locationLine = input.userLocation
      ? `User location (granted by the user, may be used to make queries location-accurate): latitude ${input.userLocation.latitude}, longitude ${input.userLocation.longitude}${typeof input.userLocation.accuracyMeters === 'number' ? `, accuracy ~${Math.round(input.userLocation.accuracyMeters)}m` : ''}.`
      : 'User location: not provided. Do not invent or assume a location.';

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
      '- When the user location is provided AND the question is location-sensitive (current weather, nearby places, local time, local prices, local events), include the coordinates or a place name you can derive from them in queryText and searchQueries so the search results are location-accurate.',
      '- When no user location is provided, do not assume one. Ask for nothing; just leave the query general.',
      '',
      `Original text query: ${input.queryText || '(none)'}`,
      `Caller intent: ${input.intent || '(none)'}`,
      `Freshness: ${input.freshness}`,
      `Allowed modes: ${input.allowedModes.join(', ') || '(none)'}`,
      `Hints: ${JSON.stringify(input.hints)}`,
      `Image URLs attached for inspection: ${imageParts.length}`,
      locationLine,
    ].join('\n');
  }

  private buildExtractionSummariesPrompt(
    queryText: string,
    intent: string,
    documents: Array<{ excerpt: string; content: string }>,
  ): string {
    const lines: string[] = [
      'Summarize each document below.',
      'Write each summary in the SAME language as the document itself — do not translate. If the document is in Romanian, the summary is in Romanian; if Spanish, Spanish; and so on.',
      'Be generous with the details: include every specific fact, date, name, role, or quote in the source that is relevant to the retrieval query. Do not compress rich source material into a one-line summary.',
      'Keep summaries factual and grounded only in the document text.',
      'Output JSON only, no prose, no code fences:',
      '{"summaries":[{"index":<document number>,"summary":"<summary text>"}]}',
      '',
      `Retrieval query: ${queryText}`,
      `Intent: ${intent}`,
      '',
    ];
    documents.forEach((document, position) => {
      lines.push(`Document ${position + 1}:`);
      lines.push(limitText(document.excerpt || document.content, 700));
      lines.push('');
    });
    return lines.join('\n');
  }

  private buildDocumentRetentionPrompt(
    queryText: string,
    intent: string,
    freshness: string,
    documents: Array<{
      title: string;
      url: string;
      publishedAt: string | null;
      excerpt: string;
      content: string;
    }>,
  ): string {
    const lines: string[] = [
      'You are durable-memory retention support for the Swirlock RAG Engine.',
      'Return JSON only. Do not answer the user.',
      'The software will not use deterministic keyword, domain, or language rules to decide what content is durable. Your judgment is the retention signal.',
      '',
      'Task:',
      'For each extracted live document, decide whether it should be written to the durable knowledge store or used only for this retrieval turn.',
      '',
      'Schema:',
      '{"documents":[{"index":<document number>,"retention":"durable|ephemeral|reject","reason":"<short reason>"}],"overallReason":"<short reason>"}',
      '',
      'Meanings:',
      '- durable: stable knowledge that can remain useful beyond the current conversation or date.',
      '- ephemeral: time-bound, situational, live, forecast, status, ranking, price, availability, or otherwise short-lived information.',
      '- reject: off-topic, unreliable, unsafe to store, private, malformed, or too low-value for memory.',
      '',
      'Rules:',
      '- Judge from the query, intent, freshness, and document text, regardless of language.',
      '- If a document mixes durable and ephemeral facts, choose the retention class for the main useful content.',
      '- Keep reasons concise and grounded in the document.',
      '- Use every document index exactly once.',
      '',
      `Retrieval query: ${queryText}`,
      `Intent: ${intent}`,
      `Freshness requested by caller: ${freshness}`,
      '',
    ];

    documents.forEach((document, position) => {
      lines.push(`Document ${position + 1}:`);
      lines.push(`Title: ${limitText(document.title, 180)}`);
      lines.push(`URL: ${document.url}`);
      lines.push(`Published at: ${document.publishedAt ?? '(unknown)'}`);
      lines.push(
        limitText(document.excerpt || document.content || '(empty)', 900),
      );
      lines.push('');
    });

    return lines.join('\n');
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
    documents: Array<{ url: string }>,
  ): Map<string, string> | null {
    if (!isRecord(value) || !Array.isArray(value.summaries)) {
      return null;
    }

    const summariesByUrl = new Map<string, string>();

    for (const item of value.summaries) {
      if (!isRecord(item)) {
        continue;
      }

      const indexValue =
        typeof item.index === 'number'
          ? item.index
          : Number.parseInt(String(item.index), 10);
      if (!Number.isInteger(indexValue)) {
        continue;
      }

      const document = documents[indexValue - 1];
      const summary = normalizeOptionalString(item.summary, 1200);

      if (document && summary) {
        summariesByUrl.set(document.url, summary);
      }
    }

    return summariesByUrl;
  }

  private normalizeDocumentRetentionJson(
    value: unknown,
    documents: Array<{ url: string }>,
  ): UtilityLlmDocumentRetentionDecision['retentionByUrl'] | null {
    if (!isRecord(value) || !Array.isArray(value.documents)) {
      return null;
    }

    const retentionByUrl: UtilityLlmDocumentRetentionDecision['retentionByUrl'] =
      new Map();

    for (const item of value.documents) {
      if (!isRecord(item)) {
        continue;
      }

      const indexValue =
        typeof item.index === 'number'
          ? item.index
          : Number.parseInt(String(item.index), 10);
      if (!Number.isInteger(indexValue)) {
        continue;
      }

      const document = documents[indexValue - 1];
      const retention =
        item.retention === 'durable' ||
        item.retention === 'ephemeral' ||
        item.retention === 'reject'
          ? item.retention
          : null;
      const reason = normalizeOptionalString(item.reason, 400);

      if (document && retention && reason) {
        retentionByUrl.set(document.url, { retention, reason });
      }
    }

    return retentionByUrl;
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

  private get streamUrl(): string {
    const url = new URL('/v5/model', this.hostUrl);

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
