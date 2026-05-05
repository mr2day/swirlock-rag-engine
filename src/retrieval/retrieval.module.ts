import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { EmbeddingServiceService } from './embedding-service.service';
import { EmbeddingWorkerService } from './embedding-worker.service';
import { KnowledgeStoreService } from './knowledge-store.service';
import { RetrievalController } from './retrieval.controller';
import { RetrievalPolicyService } from './retrieval-policy.service';
import { RetrievalService } from './retrieval.service';
import { UtilityLlmService } from './utility-llm.service';

@Module({
  imports: [SearchModule],
  controllers: [RetrievalController],
  providers: [
    KnowledgeStoreService,
    RetrievalPolicyService,
    RetrievalService,
    UtilityLlmService,
    EmbeddingServiceService,
    EmbeddingWorkerService,
  ],
  exports: [
    RetrievalService,
    KnowledgeStoreService,
    UtilityLlmService,
    EmbeddingServiceService,
  ],
})
export class RetrievalModule {}
