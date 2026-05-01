import { createUuidV7 } from './ids';

export interface ApiMeta {
  requestId: string;
  correlationId: string;
  apiVersion: string;
  servedAt: string;
}

export interface ApiEnvelope<TData> {
  meta: ApiMeta;
  data: TData;
}

export interface ErrorEnvelope {
  meta: ApiMeta;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

export function createApiMeta(
  correlationId: string | null | undefined,
  apiVersion = 'v2',
): ApiMeta {
  return {
    requestId: createUuidV7(),
    correlationId: correlationId?.trim() || 'missing-correlation-id',
    apiVersion,
    servedAt: new Date().toISOString(),
  };
}

export function isIsoUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return false;
  }

  const parsed = new Date(value);

  return !Number.isNaN(parsed.getTime());
}
