const HARDCODED_FALLBACK_LOCATION = 'Bucharest, Romania';
const HARDCODED_FALLBACK_COUNTRY = 'romania';
const HARDCODED_FALLBACK_USER_LOCATION = 'RO';
const CURRENT_WEATHER_PREFERRED_EXCLUDE_DOMAINS = [
  'climate-data.org',
  'predictwind.com',
];

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
  executionHints: SearchExecutionHints;
}

export interface SearchExecutionHints {
  intent: 'general' | 'current-weather';
  exaUserLocation: string | null;
  tavilyCountry: string | null;
  excludeDomains: string[];
  forceFreshContent: boolean;
}

export function resolveSearchQuery(query: string): SearchQueryResolution {
  const originalQuery = query.trim();

  if (!originalQuery) {
    return {
      originalQuery,
      effectiveQuery: originalQuery,
      appliedLocationFallback: null,
      notes: [],
      executionHints: buildExecutionHints(originalQuery, null),
    };
  }

  const isCurrentWeatherQuery = isLocationSensitiveQuery(originalQuery);
  const needsLocationFallback =
    isCurrentWeatherQuery && !hasExplicitLocation(originalQuery);

  if (!needsLocationFallback) {
    return {
      originalQuery,
      effectiveQuery: originalQuery,
      appliedLocationFallback: null,
      notes: [],
      executionHints: buildExecutionHints(originalQuery, null),
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
    executionHints: buildExecutionHints(
      originalQuery,
      HARDCODED_FALLBACK_LOCATION,
    ),
  };
}

function isLocationSensitiveQuery(query: string): boolean {
  return LOCATION_SENSITIVE_PATTERNS.every((pattern) => pattern.test(query));
}

function hasExplicitLocation(query: string): boolean {
  return EXPLICIT_LOCATION_PATTERNS.some((pattern) => pattern.test(query));
}

function rewriteWithFallbackLocation(query: string): string {
  if (isLocationSensitiveQuery(query)) {
    return `current weather and temperature right now in ${HARDCODED_FALLBACK_LOCATION}`;
  }

  return `${query} in ${HARDCODED_FALLBACK_LOCATION}`;
}

function buildExecutionHints(
  query: string,
  appliedLocationFallback: string | null,
): SearchExecutionHints {
  if (!isLocationSensitiveQuery(query)) {
    return {
      intent: 'general',
      exaUserLocation: null,
      tavilyCountry: null,
      excludeDomains: [],
      forceFreshContent: false,
    };
  }

  const hasRomaniaContext =
    appliedLocationFallback === HARDCODED_FALLBACK_LOCATION ||
    /\bbucharest\b/i.test(query) ||
    /\bromania\b/i.test(query);

  return {
    intent: 'current-weather',
    exaUserLocation: hasRomaniaContext ? HARDCODED_FALLBACK_USER_LOCATION : null,
    tavilyCountry: hasRomaniaContext ? HARDCODED_FALLBACK_COUNTRY : null,
    excludeDomains: [...CURRENT_WEATHER_PREFERRED_EXCLUDE_DOMAINS],
    forceFreshContent: true,
  };
}
