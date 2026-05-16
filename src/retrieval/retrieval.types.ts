export type RequestPriority = 'interactive' | 'background' | 'maintenance';
export type RetrievalFreshness = 'low' | 'medium' | 'high' | 'realtime';
export type RetrievalAllowedMode = 'local_rag' | 'live_web';
export type RetrievalMode =
  | 'none'
  | 'local_rag'
  | 'live_web'
  | 'local_and_live';
export type Modality = 'text';
export type EvidenceSourceType = 'web' | 'local_cache';

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

export type InputPart = TextInputPart;

export interface RetrievalHint {
  kind:
    | 'entity'
    | 'time_reference'
    | 'preference'
    | 'disambiguation'
    | 'constraint';
  text: string;
}

export interface UserLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt?: string;
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
    userLocation?: UserLocation;
  };
}

export interface NormalizedQuery {
  modality: Modality;
  intent: string;
  queryText: string;
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

export interface RetrievalDiagnostics {
  liveSearchPerformed: boolean;
  localSearchPerformed: boolean;
  durationMs: number;
  localResultCount?: number;
  liveResultCount?: number;
  liveSearchError?: string;
  warnings?: string[];
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
  /**
   * Prose answer-aid produced by the utility LLM from the raw,
   * uncapped extracted page text. Present when live retrieval ran and
   * the utility LLM was reachable. Consumers should prefer this over
   * stitching the snippets in evidenceChunks themselves — those are
   * truncated for stream-event payload size and for the legacy code
   * path that does not run the distillation step.
   */
  preparedPrompt?: string;
  preparedPromptModel?: string | null;
  retrievalDiagnostics: RetrievalDiagnostics;
}

export type RetrievalStreamEventType =
  | 'retrieval.started'
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
  | 'distillation.started'
  | 'distillation.completed'
  | 'distillation.skipped'
  | 'evidence.chunk'
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
    allowedModes: RetrievalAllowedMode[];
    hints: RetrievalHint[];
  };
}
