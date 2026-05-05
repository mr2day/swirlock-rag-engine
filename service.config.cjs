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
  utilityLlm: {
    enabled: true,
    hostUrl: 'http://127.0.0.1:3213',
    timeoutMs: 30000,
    retries: 1,
  },
  embeddingService: {
    enabled: true,
    url: 'http://127.0.0.1:3002',
    modelId: 'bge-small-en-v1.5',
    dimensions: 384,
    timeoutMs: 15000,
    retries: 1,
  },
  embeddingWorker: {
    enabled: true,
    pollIntervalMs: 2000,
    idlePollIntervalMs: 15000,
    batchSize: 16,
    maxAttempts: 5,
    initialBackoffMs: 5000,
    maxBackoffMs: 600000,
  },
};

function buildEnv(source = process.env) {
  const env = {
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
    UTILITY_LLM_ENABLED:
      source.UTILITY_LLM_ENABLED || String(runtime.utilityLlm.enabled),
    UTILITY_LLM_HOST_URL:
      source.UTILITY_LLM_HOST_URL || runtime.utilityLlm.hostUrl,
    UTILITY_LLM_TIMEOUT_MS:
      source.UTILITY_LLM_TIMEOUT_MS || String(runtime.utilityLlm.timeoutMs),
    UTILITY_LLM_RETRIES:
      source.UTILITY_LLM_RETRIES || String(runtime.utilityLlm.retries),
    EMBEDDING_SERVICE_ENABLED:
      source.EMBEDDING_SERVICE_ENABLED ||
      String(runtime.embeddingService.enabled),
    EMBEDDING_SERVICE_URL:
      source.EMBEDDING_SERVICE_URL || runtime.embeddingService.url,
    EMBEDDING_SERVICE_MODEL_ID:
      source.EMBEDDING_SERVICE_MODEL_ID || runtime.embeddingService.modelId,
    EMBEDDING_SERVICE_DIMENSIONS:
      source.EMBEDDING_SERVICE_DIMENSIONS ||
      String(runtime.embeddingService.dimensions),
    EMBEDDING_SERVICE_TIMEOUT_MS:
      source.EMBEDDING_SERVICE_TIMEOUT_MS ||
      String(runtime.embeddingService.timeoutMs),
    EMBEDDING_SERVICE_RETRIES:
      source.EMBEDDING_SERVICE_RETRIES ||
      String(runtime.embeddingService.retries),
    EMBEDDING_WORKER_ENABLED:
      source.EMBEDDING_WORKER_ENABLED ||
      String(runtime.embeddingWorker.enabled),
    EMBEDDING_WORKER_POLL_INTERVAL_MS:
      source.EMBEDDING_WORKER_POLL_INTERVAL_MS ||
      String(runtime.embeddingWorker.pollIntervalMs),
    EMBEDDING_WORKER_IDLE_POLL_INTERVAL_MS:
      source.EMBEDDING_WORKER_IDLE_POLL_INTERVAL_MS ||
      String(runtime.embeddingWorker.idlePollIntervalMs),
    EMBEDDING_WORKER_BATCH_SIZE:
      source.EMBEDDING_WORKER_BATCH_SIZE ||
      String(runtime.embeddingWorker.batchSize),
    EMBEDDING_WORKER_MAX_ATTEMPTS:
      source.EMBEDDING_WORKER_MAX_ATTEMPTS ||
      String(runtime.embeddingWorker.maxAttempts),
    EMBEDDING_WORKER_INITIAL_BACKOFF_MS:
      source.EMBEDDING_WORKER_INITIAL_BACKOFF_MS ||
      String(runtime.embeddingWorker.initialBackoffMs),
    EMBEDDING_WORKER_MAX_BACKOFF_MS:
      source.EMBEDDING_WORKER_MAX_BACKOFF_MS ||
      String(runtime.embeddingWorker.maxBackoffMs),
  };

  if (source.RAG_DATABASE_URL) {
    env.RAG_DATABASE_URL = source.RAG_DATABASE_URL;
  }

  if (source.EXA_API_KEY) {
    env.EXA_API_KEY = source.EXA_API_KEY;
  }

  return env;
}

const env = buildEnv();

module.exports = {
  runtime,
  env,
  buildEnv,
};
