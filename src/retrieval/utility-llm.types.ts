import type { EvidenceChunk, ImageInputPart } from './retrieval.types';

export interface UtilityLlmStatus {
  enabled: boolean;
  configuredUrl: string;
  ready: boolean;
  loaded?: boolean;
  modelId?: string;
  capabilities?: {
    textInput: boolean;
    imageInput: boolean;
    textOutput: boolean;
    imageOutput: boolean;
  };
  capacity?: {
    activeRequests: number;
    modelSlots: number;
    queueDepth: number;
    averageRequestDurationMs?: number;
  };
  error?: string;
  durationMs: number;
}

export interface UtilityLlmCallDiagnostics {
  task: string;
  attempted: boolean;
  succeeded: boolean;
  durationMs: number;
  attempts: number;
  error?: string;
}

export interface UtilityLlmRetrievalSupportInput {
  correlationId: string;
  queryText: string;
  freshness: string;
  allowedModes: string[];
  intent?: string;
  hints: Array<{ kind: string; text: string }>;
  imageParts: ImageInputPart[];
}

export interface UtilityLlmRetrievalSupport {
  queryText: string | null;
  intent: string | null;
  searchQueries: string[];
  imageObservations: string[];
  usedForQuery: boolean;
  usedForImages: boolean;
  warnings: string[];
  diagnostics: UtilityLlmCallDiagnostics[];
}

export interface UtilityLlmExtractionSummariesInput {
  correlationId: string;
  queryText: string;
  intent: string;
  documents: Array<{
    title: string;
    url: string;
    excerpt: string;
    content: string;
    publishedAt: string | null;
  }>;
}

export interface UtilityLlmExtractionSummaries {
  summariesByUrl: Map<string, string>;
  warnings: string[];
  diagnostics: UtilityLlmCallDiagnostics[];
}

export interface UtilityLlmEvidenceSynthesisInput {
  correlationId: string;
  queryText: string;
  synthesisMode: 'brief' | 'detailed';
  evidenceChunks: EvidenceChunk[];
  caveats: string[];
}

export interface UtilityLlmEvidenceSynthesis {
  synthesis: {
    summary: string;
    confidence: 'low' | 'medium' | 'high';
    caveats: string[];
  } | null;
  warnings: string[];
  diagnostics: UtilityLlmCallDiagnostics[];
}
