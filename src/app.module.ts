import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadServiceEnv } from './config/service-config';
import { DevModule } from './dev/dev.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [loadServiceEnv],
    }),
    RetrievalModule,
    SearchModule,
    DevModule,
  ],
})
export class AppModule {}
