import { createHash } from 'node:crypto';
import { createDeterministicUuid } from '../common/ids';

const DEFAULT_CHUNK_TARGET_LENGTH = 1600;
const DEFAULT_CHUNK_OVERLAP_LENGTH = 240;
const MIN_CHUNK_LENGTH = 240;
const EXCERPT_LENGTH = 700;

export interface KnowledgeChunk {
  id: string;
  index: number;
  content: string;
  excerpt: string;
  contentHash: string;
  startOffset: number;
  endOffset: number;
}

export interface RefreshPolicy {
  refreshAfter: string;
  refreshReason: string;
}

export function normalizeKnowledgeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalizeUrl(
  value: string | null | undefined,
): string | null {
  if (!value?.trim()) {
    return null;
  }

  try {
    const url = new URL(value.trim());

    url.hash = '';
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');

    for (const parameter of [...url.searchParams.keys()]) {
      const normalized = parameter.toLowerCase();

      if (
        normalized.startsWith('utm_') ||
        [
          'fbclid',
          'gclid',
          'mc_cid',
          'mc_eid',
          'igshid',
          'ref',
          'ref_src',
        ].includes(normalized)
      ) {
        url.searchParams.delete(parameter);
      }
    }

    url.searchParams.sort();

    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }

    return url.toString();
  } catch {
    return value.trim();
  }
}

export function getSourceDomain(
  value: string | null | undefined,
): string | null {
  const canonicalUrl = canonicalizeUrl(value);

  if (!canonicalUrl) {
    return null;
  }

  try {
    return new URL(canonicalUrl).hostname;
  } catch {
    return null;
  }
}

export function createStableDocumentId(input: {
  canonicalUrl: string | null;
  contentHash: string;
  title: string;
}): string {
  const stableKey = input.canonicalUrl || `${input.contentHash}:${input.title}`;

  return createDeterministicUuid(`rag-document:${stableKey}`);
}

export function chunkKnowledgeContent(input: {
  documentId: string;
  content: string;
  targetLength?: number;
  overlapLength?: number;
}): KnowledgeChunk[] {
  const normalized = normalizeKnowledgeText(input.content);

  if (!normalized) {
    return [];
  }

  const targetLength = input.targetLength ?? DEFAULT_CHUNK_TARGET_LENGTH;
  const overlapLength = input.overlapLength ?? DEFAULT_CHUNK_OVERLAP_LENGTH;
  const chunks: KnowledgeChunk[] = [];
  let startOffset = 0;

  while (startOffset < normalized.length) {
    const requestedEnd = Math.min(
      normalized.length,
      startOffset + targetLength,
    );
    let endOffset = requestedEnd;

    if (requestedEnd < normalized.length) {
      const sentenceBoundary = normalized.lastIndexOf('. ', requestedEnd);
      const paragraphBoundary = normalized.lastIndexOf('\n', requestedEnd);
      const boundary = Math.max(sentenceBoundary + 1, paragraphBoundary);

      if (boundary > startOffset + MIN_CHUNK_LENGTH) {
        endOffset = boundary;
      }
    }

    const content = normalized.slice(startOffset, endOffset).trim();

    if (content.length >= MIN_CHUNK_LENGTH || chunks.length === 0) {
      const contentHash = hashText(content);
      const index = chunks.length;

      chunks.push({
        id: createDeterministicUuid(
          `rag-chunk:${input.documentId}:${index}:${contentHash}`,
        ),
        index,
        content,
        excerpt: limitText(content, EXCERPT_LENGTH),
        contentHash,
        startOffset,
        endOffset,
      });
    }

    if (endOffset >= normalized.length) {
      break;
    }

    startOffset = Math.max(endOffset - overlapLength, startOffset + 1);
  }

  return chunks;
}

export function scoreSourceQuality(input: {
  sourceUrl: string | null;
  sourceTitle: string;
}): number {
  const domain = getSourceDomain(input.sourceUrl);
  let score = 0.55;

  if (!domain) {
    return score;
  }

  if (domain.endsWith('.gov') || domain.endsWith('.edu')) {
    score += 0.2;
  }

  if (
    /\b(docs|developer|research|standards|spec|official|manual)\b/i.test(
      `${domain} ${input.sourceTitle}`,
    )
  ) {
    score += 0.12;
  }

  if (/\b(wiki|forum|reddit|medium|substack)\b/i.test(domain)) {
    score -= 0.08;
  }

  if (/\b(download|login|signup|tracking|affiliate)\b/i.test(domain)) {
    score -= 0.15;
  }

  return roundScore(score);
}

export function computeRefreshPolicy(input: {
  publishedAt: string | null;
  retrievedAt: string;
  freshnessIntent: 'low' | 'medium' | 'high' | 'realtime';
  sourceUrl: string | null;
}): RefreshPolicy {
  const retrievedAtMs = Date.parse(input.retrievedAt);
  const base = Number.isFinite(retrievedAtMs) ? retrievedAtMs : Date.now();
  const domain = getSourceDomain(input.sourceUrl) ?? '';
  const publishedAtMs = Date.parse(input.publishedAt ?? '');
  const ageDays = Number.isFinite(publishedAtMs)
    ? Math.max(0, (base - publishedAtMs) / (1000 * 60 * 60 * 24))
    : null;
  let refreshDays = 90;
  let refreshReason = 'low volatility source';

  if (input.freshnessIntent === 'realtime') {
    refreshDays = 1;
    refreshReason = 'realtime retrieval intent';
  } else if (input.freshnessIntent === 'high') {
    refreshDays = 7;
    refreshReason = 'high freshness retrieval intent';
  } else if (input.freshnessIntent === 'medium') {
    refreshDays = 30;
    refreshReason = 'medium freshness retrieval intent';
  }

  if (/\b(news|market|weather|sports|finance|stock|quote)\b/i.test(domain)) {
    refreshDays = Math.min(refreshDays, 3);
    refreshReason = 'volatile source domain';
  }

  if (ageDays !== null && ageDays > 365) {
    refreshDays = Math.max(refreshDays, 180);
    refreshReason = 'older published source';
  }

  return {
    refreshAfter: new Date(
      base + refreshDays * 24 * 60 * 60 * 1000,
    ).toISOString(),
    refreshReason,
  };
}

export function selectDiverseResults<T>(
  results: T[],
  maxResults: number,
  getDomain: (result: T) => string | null,
  getScore: (result: T) => number,
): T[] {
  const selected: T[] = [];
  const remaining = [...results].sort(
    (left, right) => getScore(right) - getScore(left),
  );
  const domainCounts = new Map<string, number>();

  while (remaining.length > 0 && selected.length < maxResults) {
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const domain = getDomain(candidate) ?? 'unknown';
      const domainPenalty = (domainCounts.get(domain) ?? 0) * 0.12;
      const adjustedScore = getScore(candidate) - domainPenalty;

      if (adjustedScore > bestAdjustedScore) {
        bestIndex = index;
        bestAdjustedScore = adjustedScore;
      }
    }

    const [next] = remaining.splice(bestIndex, 1);
    const domain = getDomain(next) ?? 'unknown';

    selected.push(next);
    domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }

  return selected;
}

export function limitText(value: string, maxLength: number): string {
  const normalized = normalizeKnowledgeText(value);

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function roundScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
