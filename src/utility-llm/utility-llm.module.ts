import { Module } from '@nestjs/common';
import { DistillationService } from './distillation.service';
import { UtilityLlmService } from './utility-llm.service';

@Module({
  providers: [UtilityLlmService, DistillationService],
  exports: [UtilityLlmService, DistillationService],
})
export class UtilityLlmModule {}
