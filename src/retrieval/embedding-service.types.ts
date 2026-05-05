export type EmbeddingInputType = 'query' | 'document';

export interface EmbeddingServiceStatus {
  enabled: boolean;
  configuredUrl: string;
  ready: boolean;
  modelId?: string;
  dimensions?: number;
  normalizedByDefault?: boolean;
  capacity?: {
    activeRequests: number;
    modelSlots: number;
    queueDepth: number;
    averageRequestDurationMs?: number;
  };
  error?: string;
  durationMs: number;
}

export interface EmbeddingResult {
  modelId: string;
  dimensions: number;
  normalized: boolean;
  inputType: EmbeddingInputType;
  embeddings: number[][];
  durationMs: number;
}

export interface EmbeddingCallDiagnostics {
  attempted: boolean;
  succeeded: boolean;
  durationMs: number;
  attempts: number;
  inputCount: number;
  inputType: EmbeddingInputType;
  error?: string;
}
