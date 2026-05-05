import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Body,
  UseFilters,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { createApiMeta } from '../common/api-envelope';
import { ContractExceptionFilter } from '../common/contract-exception.filter';
import { serviceRuntimeConfig } from '../config/service-config';
import { EmbeddingServiceService } from './embedding-service.service';
import { KnowledgeStoreService } from './knowledge-store.service';
import { RetrievalService } from './retrieval.service';
import { UtilityLlmService } from './utility-llm.service';
import type {
  RetrieveEvidenceData,
  RetrieveEvidenceResponse,
  RetrievalStreamEvent,
} from './retrieval.types';
import { assertCorrelationId } from './retrieval-validation';

@Controller('v2')
@UseFilters(new ContractExceptionFilter('v2'))
export class RetrievalController {
  constructor(
    private readonly retrievalService: RetrievalService,
    private readonly knowledgeStore: KnowledgeStoreService,
    private readonly configService: ConfigService,
    private readonly utilityLlmService: UtilityLlmService,
    private readonly embeddingService: EmbeddingServiceService,
  ) {}

  @Post('retrieval/evidence')
  @HttpCode(200)
  async retrieveEvidence(
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() body: unknown,
  ): Promise<RetrieveEvidenceResponse> {
    assertCorrelationId(correlationId);

    const data: RetrieveEvidenceData =
      await this.retrievalService.retrieveEvidence(body, correlationId);

    return {
      meta: createApiMeta(correlationId, 'v2'),
      data,
    };
  }

  @Post('retrieval/evidence/stream')
  async retrieveEvidenceStream(
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() body: unknown,
    @Res() response: Response,
  ): Promise<void> {
    assertCorrelationId(correlationId);

    this.prepareSseResponse(response);

    let lastSequence = 0;

    try {
      await this.retrievalService.retrieveEvidence(
        body,
        correlationId,
        (event) => {
          lastSequence = event.sequence;
          this.writeSseEvent(response, event);
        },
      );
    } catch (error) {
      const failedEvent: RetrievalStreamEvent = {
        type: 'retrieval.failed',
        sequence: lastSequence + 1,
        occurredAt: new Date().toISOString(),
        data: {
          message: error instanceof Error ? error.message : String(error),
        },
      };

      this.writeSseEvent(response, failedEvent);
    } finally {
      response.end();
    }
  }

  @Get('health')
  async getHealth(@Headers('x-correlation-id') correlationId?: string) {
    const knowledgeStore = await this.knowledgeStore.getStatus();
    const [embeddingService, embeddingJobs] = await Promise.all([
      this.embeddingService.getStatus(correlationId || 'health-check'),
      this.knowledgeStore.getEmbeddingJobStats(),
    ]);
    const status =
      knowledgeStore.ready &&
      (embeddingService.ready || !embeddingService.enabled)
        ? 'ok'
        : knowledgeStore.ready
          ? 'degraded'
          : 'unavailable';

    return {
      meta: createApiMeta(correlationId, 'v2'),
      data: {
        status,
        ready: knowledgeStore.ready,
        service: serviceRuntimeConfig.serviceName,
        apiVersion: serviceRuntimeConfig.apiVersion,
        knowledgeStore,
        embeddingJobs,
        providers: {
          exaConfigured: Boolean(this.configService.get<string>('EXA_API_KEY')),
          utilityLlm: await this.utilityLlmService.getStatus(
            correlationId || 'health-check',
          ),
          embeddingService,
        },
      },
    };
  }

  private prepareSseResponse(response: Response): void {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
  }

  private writeSseEvent(response: Response, event: RetrievalStreamEvent): void {
    response.write(`id: ${event.sequence}\n`);
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
