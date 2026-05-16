import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { UtilityLlmModule } from '../utility-llm/utility-llm.module';
import { EmbeddingServiceService } from './embedding-service.service';
import { EmbeddingWorkerService } from './embedding-worker.service';
import { KnowledgeStoreService } from './knowledge-store.service';
import { RetrievalPolicyService } from './retrieval-policy.service';
import { RetrievalService } from './retrieval.service';
import { SearchRunService } from './search-run.service';

@Module({
  imports: [SearchModule, UtilityLlmModule],
  providers: [
    KnowledgeStoreService,
    RetrievalPolicyService,
    RetrievalService,
    EmbeddingServiceService,
    EmbeddingWorkerService,
    SearchRunService,
  ],
  exports: [
    RetrievalService,
    KnowledgeStoreService,
    EmbeddingServiceService,
    SearchRunService,
  ],
})
export class RetrievalModule {}
