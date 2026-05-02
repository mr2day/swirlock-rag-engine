export interface KnowledgeStoreMigration {
  version: number;
  name: string;
  sql: string;
}

export const KNOWLEDGE_STORE_SCHEMA_VERSION = 1;

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
];
