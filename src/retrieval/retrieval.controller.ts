import {
  Controller,
  Get,
  Headers,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createApiMeta } from '../common/api-envelope';
import { ContractExceptionFilter } from '../common/contract-exception.filter';
import { serviceRuntimeConfig } from '../config/service-config';
import { EmbeddingServiceService } from './embedding-service.service';
import { KnowledgeStoreService } from './knowledge-store.service';
import { UtilityLlmService } from './utility-llm.service';

@Controller('v2')
@UseFilters(new ContractExceptionFilter('v2'))
export class RetrievalController {
  constructor(
    private readonly knowledgeStore: KnowledgeStoreService,
    private readonly configService: ConfigService,
    private readonly utilityLlmService: UtilityLlmService,
    private readonly embeddingService: EmbeddingServiceService,
  ) {}

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
}
