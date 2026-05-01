import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = Number.parseInt(configService.get<string>('PORT') ?? '', 10);
  const host = configService.get<string>('HOST');

  if (!Number.isInteger(port) || port < 1 || !host) {
    throw new Error('HOST and PORT must be configured in service.config.cjs.');
  }

  await app.listen(port, host);
}
void bootstrap();
