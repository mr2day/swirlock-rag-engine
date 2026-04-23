// =======================
// INPUT
// =======================

export type RagInputPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      imageId: string; // reference to stored image (not raw binary)
      mimeType: string;
    };

export interface RagEngineInput {
  userId: string;
  conversationId: string;
  messageId: string;

  parts: RagInputPart[];

  receivedAt: string; // ISO timestamp
}

// =======================
// NORMALIZED QUERY
// =======================

export type RetrievalMode =
  | 'none'
  | 'local_rag'
  | 'live_web'
  | 'local_and_live';

export type FreshnessLevel = 'low' | 'medium' | 'high';

export interface NormalizedQuery {
  modality: 'text' | 'image' | 'multimodal';

  // interpreted user intent (free-form but concise)
  intent: string;

  // main query used for retrieval/search
  queryText: string;

  // extracted observations from image(s)
  imageObservations: string[];

  // routing decision
  retrievalMode: RetrievalMode;

  // how fresh the answer must be
  freshness: FreshnessLevel;

  // whether vision processing was required
  needsVision: boolean;

  // short explanation (debug / logging)
  reason: string;
}

// =======================
// EVIDENCE
// =======================

export type SourceType =
  | 'web'
  | 'local_db'
  | 'document'
  | 'memory'
  | 'image_analysis';

export interface EvidenceChunk {
  id: string;

  sourceType: SourceType;

  sourceTitle: string;
  sourceUrl?: string;

  content: string;

  // semantic relevance (0–1 or 0–100 depending on your later choice)
  relevanceScore: number;

  // optional freshness score
  freshnessScore?: number;

  retrievedAt: string; // ISO timestamp
  publishedAt?: string; // if known
}

// =======================
// OUTPUT
// =======================

export interface RagEngineResult {
  normalizedQuery: NormalizedQuery;

  // queries used for:
  // - search engines
  // - vector retrieval
  searchQueries: string[];

  evidenceChunks: EvidenceChunk[];

  // final assembled context sent to main LLM
  synthesizedContextWindow: string;
}