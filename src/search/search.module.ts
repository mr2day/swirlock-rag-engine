import { Module } from '@nestjs/common';
import { SearchTestController } from './search-test.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchTestController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
