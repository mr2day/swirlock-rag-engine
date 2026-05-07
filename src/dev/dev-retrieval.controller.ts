import { Controller, Get, Header } from '@nestjs/common';
import { devRetrievalPageHtml } from './dev-retrieval-page';

@Controller('dev/search')
export class DevRetrievalController {
  @Get('ui')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  getUi(): string {
    return devRetrievalPageHtml;
  }
}
