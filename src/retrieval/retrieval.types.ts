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
  knowledgeStorePath?: string;
}

export interface RetrieveEvidenceData {
  normalizedQuery: NormalizedQuery;
  searchQueries: string[];
  evidenceChunks: EvidenceChunk[];
  evidenceSynthesis?: EvidenceSynthesis;
  retrievalDiagnostics: RetrievalDiagnostics;
}

export type RetrieveEvidenceResponse = ApiEnvelope<RetrieveEvidenceData>;

export interface ValidatedRetrieveEvidenceRequest extends RetrieveEvidenceRequest {
  query: RetrieveEvidenceRequest['query'] & {
    maxEvidenceChunks: number;
    synthesisMode: SynthesisMode;
    allowedModes: RetrievalAllowedMode[];
    hints: RetrievalHint[];
  };
}
