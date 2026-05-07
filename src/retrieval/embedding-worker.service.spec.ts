import type { ConfigService } from '@nestjs/config';
import type { EmbeddingServiceService } from './embedding-service.service';
import { EmbeddingWorkerService } from './embedding-worker.service';
import type { KnowledgeStoreService } from './knowledge-store.service';

describe('EmbeddingWorkerService', () => {
  it('caps document text sent to the embedding host', async () => {
    const claimPendingEmbeddingJobs = jest.fn().mockResolvedValue([
      {
        jobId: 'job-1',
        chunkId: 'chunk-1',
        attempts: 1,
        content: Array.from({ length: 500 }, () => 'weather').join(' '),
      },
    ]);
    const writeChunkEmbedding = jest.fn().mockResolvedValue(undefined);
    const embed = jest.fn().mockResolvedValue({
      result: {
        modelId: 'test-embedding-model',
        dimensions: 3,
        normalized: true,
        inputType: 'document',
        embeddings: [[0.1, 0.2, 0.3]],
        durationMs: 4,
      },
      diagnostics: {
        attempted: true,
        succeeded: true,
        durationMs: 4,
        attempts: 1,
        inputCount: 1,
        inputType: 'document',
      },
    });
    const service = new EmbeddingWorkerService(
      {
        get: jest.fn((key: string) =>
          key === 'EMBEDDING_WORKER_BATCH_SIZE' ? '10' : undefined,
        ),
      } as unknown as ConfigService,
      {
        claimPendingEmbeddingJobs,
        writeChunkEmbedding,
      } as unknown as KnowledgeStoreService,
      {
        embed,
        getConfiguration: jest.fn().mockReturnValue({ enabled: true }),
      } as unknown as EmbeddingServiceService,
    );

    await expect(service.drainOnce()).resolves.toEqual({
      processed: 1,
      failed: 0,
    });

    const texts = embed.mock.calls[0]?.[1] as string[];
    expect(texts[0]?.split(/\s+/).length).toBeLessThanOrEqual(320);
    expect(texts[0]?.length).toBeLessThanOrEqual(1400);
    expect(writeChunkEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        chunkId: 'chunk-1',
        embedding: [0.1, 0.2, 0.3],
      }),
    );
  });
});
