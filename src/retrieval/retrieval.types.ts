import type { ApiEnvelope } from '../common/api-envelope';

export type RequestPriority = 'interactive' | 'background' | 'maintenance';
export type RetrievalFreshness = 'low' | 'medium' | 'high' | 'realtime';
export type RetrievalAllowedMode = 'local_rag' | 'live_web';
export type RetrievalMode =
  | 'none'
  | 'local_rag'
  | 'live_web'
  | 'local_and_live';
export type SynthesisMode = 'none' | 'brief' | 'detailed';
export type Modality = 'text' | 'image' | 'multimodal';
export type EvidenceSourceType = 'web' | 'local_cache' | 'image_analysis';

export interface RequestContext {
  callerService: string;
  priority: RequestPriority;
  requestedAt: string;
  timeoutMs?: number;
  debug?: boolean;
}

export interface TextInputPart {
  type: 'text';
  text: string;
}

export interface ImageInputPart {
  type: 'image';
  imageId?: string;
  imageUrl?: string;
  mimeType?: string;
}

export type InputPart = TextInputPart | ImageInputPart;

export interface RetrievalHint {
  kind:
    | 'entity'
    | 'time_reference'
    | 'preference'
    | 'disambiguation'
    | 'constraint';
  text: string;
}

export interface RetrieveEvidenceRequest {
  requestContext: RequestContext;
  session?: {
    sessionId?: string;
    turnId?: string;
    appId?: string;
  };
  query: {
    parts: InputPart[];
    resolvedQueryText?: string;
    intent?: string;
    hints?: RetrievalHint[];
    freshness: RetrievalFreshness;
    allowedModes?: RetrievalAllowedMode[];
    maxEvidenceChunks?: number;
    synthesisMode?: SynthesisMode;
  };
}

export interface NormalizedQuery {
  modality: Modality;
  intent: string;
  queryText: string;
  imageObservations: string[];
  retrievalMode: RetrievalMode;
  freshness: RetrievalFreshness;
  reason: string;
}

export interface EvidenceChunk {
  evidenceId: string;
  sourceType: EvidenceSourceType;
  sourceTitle: string;
  sourceUrl?: string;
  content: string;
  relevanceScore: number;
  freshnessScore?: number;
  publishedAt?: string;
  retrievedAt: string;
}

export interface EvidenceSynthesis {
  summary: string;
  confidence: 'low' | 'medium' | 'high';
  caveats: string[];
}

export interface RetrievalDiagnostics {
  liveSearchPerformed: boolean;
  localSearchPerformed: boolean;
  durationMs: number;
  localResultCount?: number;
  liveResultCount?: number;
  liveSearchError?: string;
  warnings?: string[];
  utilityLlm?: {
    enabled: boolean;
    configuredUrl: string;
    usedForQuery: boolean;
    usedForImages: boolean;
    usedForExtractionSummaries: boolean;
    usedForEvidenceSynthesis: boolean;
    calls: Array<{
      task: string;
      attempted: boolean;
      succeeded: boolean;
      durationMs: number;
      attempts: number;
      error?: string;
    }>;
  };
  embeddingService?: {
    enabled: boolean;
    configuredUrl: string;
    modelId: string;
    dimensions: number;
    usedForQuery: boolean;
    calls: Array<{
      attempted: boolean;
      succeeded: boolean;
      durationMs: number;
      attempts: number;
      inputCount: number;
      inputType: 'query' | 'document';
      error?: string;
    }>;
  };
  knowledgeStorePath?: string;
  knowledgeStoreKind?: 'postgresql' | 'json_file';
}

export interface RetrieveEvidenceData {
  normalizedQuery: NormalizedQuery;
  searchQueries: string[];
  evidenceChunks: EvidenceChunk[];
  evidenceSynthesis?: EvidenceSynthesis;
  retrievalDiagnostics: RetrievalDiagnostics;
}

export type RetrieveEvidenceResponse = ApiEnvelope<RetrieveEvidenceData>;

export type RetrievalStreamEventType =
  | 'retrieval.started'
  | 'utility_llm.retrieval_support.started'
  | 'utility_llm.retrieval_support.completed'
  | 'query.normalized'
  | 'embedding.query.started'
  | 'embedding.query.completed'
  | 'local.search.started'
  | 'local.search.completed'
  | 'retrieval.policy.decided'
  | 'live.search.started'
  | 'live.search.completed'
  | 'live.extract.started'
  | 'live.extract.completed'
  | 'utility_llm.extraction_summaries.started'
  | 'utility_llm.extraction_summaries.completed'
  | 'evidence.chunk'
  | 'utility_llm.evidence_synthesis.started'
  | 'utility_llm.evidence_synthesis.completed'
  | 'retrieval.completed'
  | 'retrieval.failed';

export interface RetrievalStreamEvent {
  type: RetrievalStreamEventType;
  sequence: number;
  occurredAt: string;
  data: Record<string, unknown>;
}

export type RetrievalStreamEmitter = (
  event: RetrievalStreamEvent,
) => void | Promise<void>;

export interface ValidatedRetrieveEvidenceRequest extends RetrieveEvidenceRequest {
  query: RetrieveEvidenceRequest['query'] & {
    maxEvidenceChunks: number;
    synthesisMode: SynthesisMode;
    allowedModes: RetrievalAllowedMode[];
    hints: RetrievalHint[];
  };
}
