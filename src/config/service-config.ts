import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

type ServiceConfigModule = {
  runtime: {
    serviceName: string;
    apiVersion: 'v2';
    host: string;
    port: number;
    knowledgeStorePath: string;
    maxEvidenceChunks: number;
    liveSearchLimit: number;
    liveExtractLimit: number;
    utilityLlm: {
      enabled: boolean;
      hostUrl: string;
      timeoutMs: number;
      retries: number;
    };
    embeddingService: {
      enabled: boolean;
      url: string;
      modelId: string;
      dimensions: number;
      timeoutMs: number;
      retries: number;
    };
    embeddingWorker: {
      enabled: boolean;
      pollIntervalMs: number;
      idlePollIntervalMs: number;
      batchSize: number;
      maxAttempts: number;
      initialBackoffMs: number;
      maxBackoffMs: number;
    };
  };
  env: Record<string, string>;
  buildEnv: () => Record<string, string>;
};

const requireConfig = createRequire(__filename);
const configPath = [
  resolve(__dirname, '../../service.config.cjs'),
  resolve(__dirname, '../../../service.config.cjs'),
].find((candidate) => existsSync(candidate));

if (!configPath) {
  throw new Error('service.config.cjs could not be resolved.');
}

const loadedConfig = requireConfig(configPath) as ServiceConfigModule;

export const serviceRuntimeConfig = loadedConfig.runtime;
export const serviceEnv = loadedConfig.env;
export const loadServiceEnv = (): Record<string, string> =>
  loadedConfig.buildEnv();
