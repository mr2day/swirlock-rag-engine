import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Body,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createApiMeta } from '../common/api-envelope';
import { ContractExceptionFilter } from '../common/contract-exception.filter';
import { serviceRuntimeConfig } from '../config/service-config';
import { KnowledgeStoreService } from './knowledge-store.service';
import { RetrievalService } from './retrieval.service';
import { UtilityLlmService } from './utility-llm.service';
import type {
  RetrieveEvidenceData,
  RetrieveEvidenceResponse,
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

  @Get('health')
  async getHealth(@Headers('x-correlation-id') correlationId?: string) {
    const knowledgeStore = await this.knowledgeStore.getStatus();

    return {
      meta: createApiMeta(correlationId, 'v2'),
      data: {
        status: 'ok',
        ready: knowledgeStore.ready,
        service: serviceRuntimeConfig.serviceName,
        apiVersion: serviceRuntimeConfig.apiVersion,
        knowledgeStore,
        providers: {
          exaConfigured: Boolean(this.configService.get<string>('EXA_API_KEY')),
          utilityLlm: await this.utilityLlmService.getStatus(
            correlationId || 'health-check',
          ),
        },
      },
    };
  }
}
