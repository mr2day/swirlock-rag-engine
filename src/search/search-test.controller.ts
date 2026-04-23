import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { isSearchProvider, type SearchProvider } from './search.types';

@Controller('dev/search')
export class SearchTestController {
  constructor(private readonly searchService: SearchService) {}

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
