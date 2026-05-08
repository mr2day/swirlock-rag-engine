import { Module } from '@nestjs/common';
import { ContentExcerptService } from './content-excerpt.service';
import { SearchService } from './search.service';
import { WikipediaSearchService } from './wikipedia-search.service';

@Module({
  providers: [ContentExcerptService, SearchService, WikipediaSearchService],
  exports: [SearchService, WikipediaSearchService],
})
export class SearchModule {}
