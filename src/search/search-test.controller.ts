import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import { SearchService } from './search.service';
import { searchTestPageHtml } from './search-test-page';
import { isSearchProvider, type SearchProvider } from './search.types';

@Controller('dev/search')
export class SearchTestController {
  constructor(private readonly searchService: SearchService) {}

  @Get('ui')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getSearchUi(): string {
    return searchTestPageHtml;
  }

  @Get()
  async testSearch(
    @Query('q') query = '',
    @Query('provider') provider = 'ddg',
  ) {
    if (!isSearchProvider(provider)) {
      throw new BadRequestException(
        'provider must be one of: ddg, tavily, exa.',
      );
    }

    return this.searchService.search(query, provider as SearchProvider);
  }
}
