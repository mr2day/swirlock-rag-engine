import { createRequire } from 'node:module';

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
  };
  env: Record<string, string>;
  buildEnv: () => Record<string, string>;
};

const requireConfig = createRequire(__filename);
const loadedConfig = requireConfig(
  '../../service.config.cjs',
) as ServiceConfigModule;

export const serviceRuntimeConfig = loadedConfig.runtime;
export const serviceEnv = loadedConfig.env;
export const loadServiceEnv = (): Record<string, string> =>
  loadedConfig.buildEnv();
