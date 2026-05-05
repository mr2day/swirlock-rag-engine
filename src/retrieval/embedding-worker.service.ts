import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { serviceRuntimeConfig } from '../config/service-config';
import { EmbeddingServiceService } from './embedding-service.service';
import { KnowledgeStoreService } from './knowledge-store.service';

const WORKER_CORRELATION_PREFIX = 'embedding-worker';

@Injectable()
export class EmbeddingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmbeddingWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly knowledgeStore: KnowledgeStoreService,
    private readonly embeddingService: EmbeddingServiceService,
  ) {}

  onModuleInit(): void {
    if (!this.workerEnabled || !this.embeddingServiceEnabled) {
      this.logger.log(
        `[embedding-worker] disabled (workerEnabled=${this.workerEnabled}, embeddingService=${this.embeddingServiceEnabled})`,
      );
      return;
    }

    this.scheduleNext(this.pollIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    while (this.running) {
      await delay(50);
    }
  }

  async drainOnce(): Promise<{ processed: number; failed: number }> {
    return this.processBatch(
      `${WORKER_CORRELATION_PREFIX}-manual-${Date.now()}`,
    );
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(
      () => {
        void this.tick();
      },
      Math.max(50, delayMs),
    );
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) {
      return;
    }

    this.running = true;

    try {
      const correlationId = `${WORKER_CORRELATION_PREFIX}-${Date.now()}`;
      const { processed, failed } = await this.processBatch(correlationId);

      const nextDelay =
        processed > 0 || failed > 0
          ? this.pollIntervalMs
          : this.idlePollIntervalMs;
      this.scheduleNext(nextDelay);
    } catch (error) {
      this.logger.warn(
        `[embedding-worker] tick failed: ${getErrorMessage(error)}`,
      );
      this.scheduleNext(this.idlePollIntervalMs);
    } finally {
      this.running = false;
    }
  }

  private async processBatch(
    correlationId: string,
  ): Promise<{ processed: number; failed: number }> {
    const claims = await this.knowledgeStore.claimPendingEmbeddingJobs(
      this.batchSize,
    );

    if (claims.length === 0) {
      return { processed: 0, failed: 0 };
    }

    const texts = claims.map((claim) => claim.content);
    const { result, diagnostics } = await this.embeddingService.embed(
      correlationId,
      texts,
      'document',
    );

    if (!diagnostics.succeeded || result.embeddings.length !== claims.length) {
      const reason =
        diagnostics.error ??
        `Embedding service returned ${result.embeddings.length} vectors for ${claims.length} chunks.`;

      await Promise.all(
        claims.map((claim) =>
          this.knowledgeStore.markEmbeddingJobFailed({
            jobId: claim.jobId,
            error: reason,
            backoffMs: this.computeBackoffMs(claim.attempts),
            maxAttempts: this.maxAttempts,
          }),
        ),
      );

      this.logger.warn(
        `[embedding-worker] failed batch of ${claims.length} chunks: ${reason}`,
      );

      return { processed: 0, failed: claims.length };
    }

    let processed = 0;
    let failed = 0;

    for (let index = 0; index < claims.length; index += 1) {
      const claim = claims[index];
      const embedding = result.embeddings[index];

      try {
        await this.knowledgeStore.writeChunkEmbedding({
          jobId: claim.jobId,
          chunkId: claim.chunkId,
          embedding,
          embeddingModel: result.modelId,
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        await this.knowledgeStore
          .markEmbeddingJobFailed({
            jobId: claim.jobId,
            error: getErrorMessage(error),
            backoffMs: this.computeBackoffMs(claim.attempts),
            maxAttempts: this.maxAttempts,
          })
          .catch((markError) =>
            this.logger.warn(
              `[embedding-worker] could not record failure for ${claim.jobId}: ${getErrorMessage(markError)}`,
            ),
          );
      }
    }

    if (processed > 0) {
      this.logger.log(
        `[embedding-worker] embedded ${processed}/${claims.length} chunks in ${result.durationMs}ms (${result.modelId}, ${result.dimensions}d).`,
      );
    }

    return { processed, failed };
  }

  private computeBackoffMs(attempts: number): number {
    const exponent = Math.max(0, attempts - 1);
    const candidate = this.initialBackoffMs * Math.pow(2, exponent);
    return Math.min(this.maxBackoffMs, candidate);
  }

  private get workerEnabled(): boolean {
    return parseBoolean(
      this.configService.get<string>('EMBEDDING_WORKER_ENABLED'),
      serviceRuntimeConfig.embeddingWorker.enabled,
    );
  }

  private get embeddingServiceEnabled(): boolean {
    return this.embeddingService.getConfiguration().enabled;
  }

  private get pollIntervalMs(): number {
    return parsePositiveInteger(
      this.configService.get<string>('EMBEDDING_WORKER_POLL_INTERVAL_MS'),
      serviceRuntimeConfig.embeddingWorker.pollIntervalMs,
    );
  }

  private get idlePollIntervalMs(): number {
    return parsePositiveInteger(
      this.configService.get<string>('EMBEDDING_WORKER_IDLE_POLL_INTERVAL_MS'),
      serviceRuntimeConfig.embeddingWorker.idlePollIntervalMs,
    );
  }

  private get batchSize(): number {
    return parsePositiveInteger(
      this.configService.get<string>('EMBEDDING_WORKER_BATCH_SIZE'),
      serviceRuntimeConfig.embeddingWorker.batchSize,
    );
  }

  private get maxAttempts(): number {
    return parsePositiveInteger(
      this.configService.get<string>('EMBEDDING_WORKER_MAX_ATTEMPTS'),
      serviceRuntimeConfig.embeddingWorker.maxAttempts,
    );
  }

  private get initialBackoffMs(): number {
    return parsePositiveInteger(
      this.configService.get<string>('EMBEDDING_WORKER_INITIAL_BACKOFF_MS'),
      serviceRuntimeConfig.embeddingWorker.initialBackoffMs,
    );
  }

  private get maxBackoffMs(): number {
    return parsePositiveInteger(
      this.configService.get<string>('EMBEDDING_WORKER_MAX_BACKOFF_MS'),
      serviceRuntimeConfig.embeddingWorker.maxBackoffMs,
    );
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
