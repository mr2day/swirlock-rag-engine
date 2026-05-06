import { Module } from '@nestjs/common';
import { ContentExcerptService } from './content-excerpt.service';
import { SearchService } from './search.service';

@Module({
  providers: [ContentExcerptService, SearchService],
  exports: [SearchService],
})
export class SearchModule {}
