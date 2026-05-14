import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Server as HttpServer } from 'node:http';
import { AppModule } from './app.module';
import { RetrievalService } from './retrieval/retrieval.service';
import { SearchRunService } from './retrieval/search-run.service';
import { attachRetrievalStreamServer } from './retrieval/retrieval-stream-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = Number.parseInt(configService.get<string>('PORT') ?? '', 10);
  const host = configService.get<string>('HOST');

  if (!Number.isInteger(port) || port < 1 || !host) {
    throw new Error('HOST and PORT must be configured in service.config.cjs.');
  }

  await app.listen(port, host);
  attachRetrievalStreamServer(
    app.getHttpServer() as HttpServer,
    app.get(RetrievalService),
    app.get(SearchRunService),
  );
}
void bootstrap();
