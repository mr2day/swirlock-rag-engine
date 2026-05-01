import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { KnowledgeStoreService } from './knowledge-store.service';
import { RetrievalController } from './retrieval.controller';
import { RetrievalPolicyService } from './retrieval-policy.service';
import { RetrievalService } from './retrieval.service';

@Module({
  imports: [SearchModule],
  controllers: [RetrievalController],
  providers: [KnowledgeStoreService, RetrievalPolicyService, RetrievalService],
  exports: [RetrievalService, KnowledgeStoreService],
})
export class RetrievalModule {}
