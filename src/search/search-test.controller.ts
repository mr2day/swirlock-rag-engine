import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Query,
} from '@nestjs/common';
import { SearchService } from './search.service';
import { searchTestPageHtml } from './search-test-page';
import { isSearchProvider } from './search.types';

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
    @Query('provider') provider = 'exa',
  ) {
    if (!isSearchProvider(provider)) {
      throw new BadRequestException('provider must be exa.');
    }

    return this.searchService.search(query, provider);
  }

  @Get('compare')
  async compareSearchThenExtract(
    @Query('q') query = '',
    @Query('searchLimit') searchLimit = '5',
    @Query('extractLimit') extractLimit = '3',
  ) {
    return this.searchService.compareSearchThenExtract(
      query,
      this.parsePositiveInt(searchLimit, 5, 'searchLimit', 10),
      this.parsePositiveInt(extractLimit, 3, 'extractLimit', 5),
    );
  }

  private parsePositiveInt(
    rawValue: string,
    fallback: number,
    fieldName: string,
    maxValue: number,
  ): number {
    if (!rawValue.trim()) {
      return fallback;
    }

    const parsed = Number.parseInt(rawValue, 10);

    if (!Number.isFinite(parsed) || parsed < 1 || parsed > maxValue) {
      throw new BadRequestException(
        `${fieldName} must be an integer between 1 and ${maxValue}.`,
      );
    }

    return parsed;
  }
}
