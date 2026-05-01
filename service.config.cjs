const path = require('node:path');

const rootDir = __dirname;

const runtime = {
  serviceName: 'swirlock-rag-engine',
  apiVersion: 'v2',
  host: '127.0.0.1',
  port: 3001,
  knowledgeStorePath: path.join(rootDir, 'data', 'knowledge-store.json'),
  maxEvidenceChunks: 12,
  liveSearchLimit: 6,
  liveExtractLimit: 4,
};

function buildEnv(source = process.env) {
  return {
    NODE_ENV: source.NODE_ENV || 'production',
    HOST: source.HOST || runtime.host,
    PORT: source.PORT || String(runtime.port),
    SWIRLOCK_API_VERSION: runtime.apiVersion,
    RAG_KNOWLEDGE_STORE_PATH:
      source.RAG_KNOWLEDGE_STORE_PATH || runtime.knowledgeStorePath,
    RAG_MAX_EVIDENCE_CHUNKS:
      source.RAG_MAX_EVIDENCE_CHUNKS || String(runtime.maxEvidenceChunks),
    RAG_LIVE_SEARCH_LIMIT:
      source.RAG_LIVE_SEARCH_LIMIT || String(runtime.liveSearchLimit),
    RAG_LIVE_EXTRACT_LIMIT:
      source.RAG_LIVE_EXTRACT_LIMIT || String(runtime.liveExtractLimit),
    EXA_API_KEY: source.EXA_API_KEY || '',
  };
}

const env = buildEnv();

module.exports = {
  runtime,
  env,
  buildEnv,
};
