const HARDCODED_FALLBACK_LOCATION = 'Bucharest, Romania';

const LOCATION_SENSITIVE_PATTERNS = [
  /\b(weather|temperature|forecast|humidity|wind|dew point|feels like|outside)\b/i,
  /\b(now|today|right now|currently)\b/i,
];

const EXPLICIT_LOCATION_PATTERNS = [
  /\b(in|at|near|for)\s+[a-z0-9][a-z0-9\s,.-]{2,}/i,
  /\bbucharest\b/i,
  /\bromania\b/i,
  /\bmy location\b/i,
  /\bhere\b/i,
  /\bzip\b/i,
  /\bpostcode\b/i,
  /\bcoordinates?\b/i,
  /\b\d{5}(?:-\d{4})?\b/,
  /\b-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+\b/,
];

export interface SearchQueryResolution {
  originalQuery: string;
  effectiveQuery: string;
  appliedLocationFallback: string | null;
  notes: string[];
}

export function resolveSearchQuery(query: string): SearchQueryResolution {
  const originalQuery = query.trim();

  if (!originalQuery) {
    return {
      originalQuery,
      effectiveQuery: originalQuery,
      appliedLocationFallback: null,
      notes: [],
    };
  }

  const needsLocationFallback =
    isLocationSensitiveQuery(originalQuery) &&
    !hasExplicitLocation(originalQuery);

  if (!needsLocationFallback) {
    return {
      originalQuery,
      effectiveQuery: originalQuery,
      appliedLocationFallback: null,
      notes: [],
    };
  }

  const effectiveQuery = rewriteWithFallbackLocation(originalQuery);

  return {
    originalQuery,
    effectiveQuery,
    appliedLocationFallback: HARDCODED_FALLBACK_LOCATION,
    notes: [
      `Location-sensitive query detected. Using hardcoded fallback location: ${HARDCODED_FALLBACK_LOCATION}.`,
    ],
  };
}

function isLocationSensitiveQuery(query: string): boolean {
  return LOCATION_SENSITIVE_PATTERNS.every((pattern) => pattern.test(query));
}

function hasExplicitLocation(query: string): boolean {
  return EXPLICIT_LOCATION_PATTERNS.some((pattern) => pattern.test(query));
}

function rewriteWithFallbackLocation(query: string): string {
  const lower = query.toLowerCase();

  if (/\b(weather|forecast)\b/.test(lower)) {
    return `${query} in ${HARDCODED_FALLBACK_LOCATION}`;
  }

  return `current weather and temperature in ${HARDCODED_FALLBACK_LOCATION}: ${query}`;
}
