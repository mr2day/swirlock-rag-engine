export interface KnowledgeStoreMigration {
  version: number;
  name: string;
  sql: string;
}

export const KNOWLEDGE_STORE_SCHEMA_VERSION = 2;

export const KNOWLEDGE_STORE_MIGRATIONS: KnowledgeStoreMigration[] = [
  {
    version: 1,
    name: 'create_knowledge_store_tables',
    sql: `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS rag_source_documents (
  id uuid PRIMARY KEY,
  source_title text NOT NULL,
  source_url citext,
  provider_summary text,
  intent text NOT NULL,
  search_queries text[] NOT NULL DEFAULT ARRAY[]::text[],
  published_at timestamptz,
  first_retrieved_at timestamptz NOT NULL,
  last_retrieved_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  times_seen integer NOT NULL DEFAULT 1 CHECK (times_seen > 0),
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rag_source_documents_source_url_unique
  ON rag_source_documents (source_url)
  WHERE source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS rag_source_documents_content_hash_idx
  ON rag_source_documents (content_hash);

CREATE INDEX IF NOT EXISTS rag_source_documents_last_retrieved_idx
  ON rag_source_documents (last_retrieved_at DESC);

CREATE TABLE IF NOT EXISTS rag_document_chunks (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES rag_source_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  source_title text NOT NULL,
  source_url citext,
  content text NOT NULL,
  excerpt text NOT NULL,
  provider_summary text,
  intent text NOT NULL,
  search_queries text[] NOT NULL DEFAULT ARRAY[]::text[],
  published_at timestamptz,
  first_retrieved_at timestamptz NOT NULL,
  last_retrieved_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  times_seen integer NOT NULL DEFAULT 1 CHECK (times_seen > 0),
  content_hash text NOT NULL,
  search_vector tsvector NOT NULL,
  embedding vector,
  embedding_model text,
  embedding_dimensions integer,
  embedding_updated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS rag_document_chunks_search_vector_idx
  ON rag_document_chunks USING gin (search_vector);

CREATE INDEX IF NOT EXISTS rag_document_chunks_source_url_idx
  ON rag_document_chunks (source_url)
  WHERE source_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS rag_document_chunks_content_hash_idx
  ON rag_document_chunks (content_hash);

CREATE INDEX IF NOT EXISTS rag_document_chunks_last_retrieved_idx
  ON rag_document_chunks (last_retrieved_at DESC);

CREATE TABLE IF NOT EXISTS rag_retrieval_runs (
  id uuid PRIMARY KEY,
  correlation_id text NOT NULL,
  query_text text NOT NULL,
  intent text NOT NULL,
  retrieval_mode text NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  local_result_count integer NOT NULL DEFAULT 0 CHECK (local_result_count >= 0),
  live_result_count integer NOT NULL DEFAULT 0 CHECK (live_result_count >= 0),
  evidence_chunk_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  retrieved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_retrieval_runs_correlation_idx
  ON rag_retrieval_runs (correlation_id);

CREATE INDEX IF NOT EXISTS rag_retrieval_runs_retrieved_at_idx
  ON rag_retrieval_runs (retrieved_at DESC);
`,
  },
  {
    version: 2,
    name: 'add_ingestion_indexing_metadata',
    sql: `
ALTER TABLE rag_source_documents
  ADD COLUMN IF NOT EXISTS canonical_url citext,
  ADD COLUMN IF NOT EXISTS source_domain text,
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS raw_content_hash text,
  ADD COLUMN IF NOT EXISTS cleaned_content_hash text,
  ADD COLUMN IF NOT EXISTS chunk_count integer NOT NULL DEFAULT 1 CHECK (chunk_count > 0),
  ADD COLUMN IF NOT EXISTS extraction_provider text,
  ADD COLUMN IF NOT EXISTS refresh_after timestamptz,
  ADD COLUMN IF NOT EXISTS refresh_reason text,
  ADD COLUMN IF NOT EXISTS last_refresh_status text NOT NULL DEFAULT 'ok';

UPDATE rag_source_documents
SET
  canonical_url = COALESCE(canonical_url, source_url),
  raw_content_hash = COALESCE(raw_content_hash, content_hash),
  cleaned_content_hash = COALESCE(cleaned_content_hash, content_hash),
  extraction_provider = COALESCE(extraction_provider, 'exa')
WHERE canonical_url IS NULL
  OR raw_content_hash IS NULL
  OR cleaned_content_hash IS NULL
  OR extraction_provider IS NULL;

CREATE INDEX IF NOT EXISTS rag_source_documents_canonical_url_idx
  ON rag_source_documents (canonical_url)
  WHERE canonical_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS rag_source_documents_source_domain_idx
  ON rag_source_documents (source_domain)
  WHERE source_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS rag_source_documents_refresh_after_idx
  ON rag_source_documents (refresh_after)
  WHERE refresh_after IS NOT NULL;

ALTER TABLE rag_document_chunks
  ADD COLUMN IF NOT EXISTS stable_chunk_key text,
  ADD COLUMN IF NOT EXISTS source_domain text,
  ADD COLUMN IF NOT EXISTS start_offset integer NOT NULL DEFAULT 0 CHECK (start_offset >= 0),
  ADD COLUMN IF NOT EXISTS end_offset integer NOT NULL DEFAULT 0 CHECK (end_offset >= 0),
  ADD COLUMN IF NOT EXISTS source_quality_score numeric NOT NULL DEFAULT 0.55 CHECK (source_quality_score >= 0 AND source_quality_score <= 1),
  ADD COLUMN IF NOT EXISTS lexical_score numeric NOT NULL DEFAULT 0 CHECK (lexical_score >= 0),
  ADD COLUMN IF NOT EXISTS vector_score numeric,
  ADD COLUMN IF NOT EXISTS needs_embedding boolean NOT NULL DEFAULT true;

UPDATE rag_document_chunks
SET
  stable_chunk_key = COALESCE(stable_chunk_key, document_id::text || ':' || chunk_index::text || ':' || content_hash),
  end_offset = CASE WHEN end_offset = 0 THEN length(content) ELSE end_offset END
WHERE stable_chunk_key IS NULL OR end_offset = 0;

CREATE UNIQUE INDEX IF NOT EXISTS rag_document_chunks_stable_chunk_key_unique
  ON rag_document_chunks (stable_chunk_key)
  WHERE stable_chunk_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS rag_document_chunks_source_domain_idx
  ON rag_document_chunks (source_domain)
  WHERE source_domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS rag_document_chunks_needs_embedding_idx
  ON rag_document_chunks (needs_embedding)
  WHERE needs_embedding = true;

CREATE TABLE IF NOT EXISTS rag_embedding_jobs (
  id uuid PRIMARY KEY,
  chunk_id uuid NOT NULL REFERENCES rag_document_chunks(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  embedding_model text NOT NULL DEFAULT 'unconfigured',
  priority integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  error text,
  available_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chunk_id, embedding_model)
);

CREATE INDEX IF NOT EXISTS rag_embedding_jobs_status_idx
  ON rag_embedding_jobs (status, priority DESC, available_after ASC);
`,
  },
];
