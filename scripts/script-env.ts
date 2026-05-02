import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serviceRuntimeConfig } from '../src/config/service-config';

export interface ScriptConfig {
  get(key: string): string | undefined;
}

export function loadScriptConfig(overrides: Record<string, string> = {}): {
  config: ScriptConfig;
  values: Record<string, string>;
} {
  const values = {
    ...readEnvFile('.env'),
    ...readEnvFile('.env.local'),
    ...process.env,
    ...overrides,
  } as Record<string, string>;

  return {
    values,
    config: {
      get(key: string) {
        if (key === 'RAG_KNOWLEDGE_STORE_PATH') {
          return values[key] || serviceRuntimeConfig.knowledgeStorePath;
        }

        return values[key];
      },
    },
  };
}

function readEnvFile(path: string): Record<string, string> {
  const fullPath = resolve(path);

  if (!existsSync(fullPath)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(fullPath, 'utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');

        if (separator < 0) {
          return [line, ''];
        }

        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}
