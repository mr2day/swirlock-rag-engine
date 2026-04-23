import { Module } from '@nestjs/common';
import { ContentExcerptService } from './content-excerpt.service';
import { SearchTestController } from './search-test.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchTestController],
  providers: [ContentExcerptService, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
