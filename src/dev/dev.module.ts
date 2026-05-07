import { Module } from '@nestjs/common';
import { DevRetrievalController } from './dev-retrieval.controller';

@Module({
  controllers: [DevRetrievalController],
})
export class DevModule {}
