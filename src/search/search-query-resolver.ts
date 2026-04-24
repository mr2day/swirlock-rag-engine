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

const MARKET_PRICE_CONTEXT_PATTERNS = [
  /\b(quote|stock|stocks|share|shares|market cap|exchange rate|forex|fx|crypto|cryptocurrency|ticker|trading)\b/i,
  /\b(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|xrp|aapl|msft|nvda|tsla|googl|amzn|meta|spy|qqq|eur|usd|ron|gbp|jpy)\b/i,
];

const MARKET_PRICE_SIGNAL_PATTERNS = [
  /\b(current|live|latest|today|now|right now|currently|trading at|worth)\b/i,
  /\b(price|quote|exchange rate)\b/i,
];

const MARKET_PRICE_NEGATIVE_PATTERNS = [
  /\b(history|historical|forecast|prediction|predictions|price target|analysis)\b/i,
];

const SPORTS_SCORE_SIGNAL_PATTERNS = [
  /\b(score|scores|result|results|who won|won|final|box score|scoreboard|match result|game result|live score|halftime|full[- ]time|kickoff|today|tonight|live)\b/i,
];

const SPORTS_SCORE_CONTEXT_PATTERNS = [
  /\b(game|match|vs\.?|versus|nba|wnba|nfl|mlb|nhl|epl|uefa|champions league|premier league|laliga|la liga|serie a|bundesliga|soccer|football|basketball|baseball|hockey|tennis)\b/i,
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

export type SearchIntent =
  | 'general'
  | 'current-weather'
  | 'market-price'
  | 'sports-score';

export interface SearchQueryResolution {
  originalQuery: string;
  effectiveQuery: string;
  appliedLocationFallback: string | null;
  notes: string[];
  executionHints: SearchExecutionHints;
}

export interface SearchExecutionHints {
  intent: SearchIntent;
  exaUserLocation: string | null;
  exaCategory: 'news' | null;
  tavilyCountry: string | null;
  tavilyTopic: 'general' | 'news' | 'finance';
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
      executionHints: buildExecutionHints(originalQuery, 'general', null),
    };
  }

  const intent = detectIntent(originalQuery);
  const isCurrentWeatherQuery = intent === 'current-weather';
  const needsLocationFallback =
    isCurrentWeatherQuery && !hasExplicitLocation(originalQuery);

  const appliedLocationFallback = needsLocationFallback
    ? HARDCODED_FALLBACK_LOCATION
    : null;
  const effectiveQuery = rewriteQuery(
    originalQuery,
    intent,
    appliedLocationFallback,
  );

  return {
    originalQuery,
    effectiveQuery,
    appliedLocationFallback,
    notes: appliedLocationFallback
      ? [
          `Location-sensitive query detected. Using hardcoded fallback location: ${HARDCODED_FALLBACK_LOCATION}.`,
        ]
      : [],
    executionHints: buildExecutionHints(
      originalQuery,
      intent,
      appliedLocationFallback,
    ),
  };
}

function isLocationSensitiveQuery(query: string): boolean {
  return LOCATION_SENSITIVE_PATTERNS.every((pattern) => pattern.test(query));
}

function isMarketPriceQuery(query: string): boolean {
  if (MARKET_PRICE_NEGATIVE_PATTERNS.some((pattern) => pattern.test(query))) {
    return false;
  }

  const hasContext = MARKET_PRICE_CONTEXT_PATTERNS.some((pattern) =>
    pattern.test(query),
  );
  const hasSignal = MARKET_PRICE_SIGNAL_PATTERNS.some((pattern) =>
    pattern.test(query),
  );

  return hasContext && hasSignal;
}

function isSportsScoreQuery(query: string): boolean {
  const hasContext = SPORTS_SCORE_CONTEXT_PATTERNS.some((pattern) =>
    pattern.test(query),
  );
  const hasSignal = SPORTS_SCORE_SIGNAL_PATTERNS.some((pattern) =>
    pattern.test(query),
  );

  return hasContext && hasSignal;
}

function hasExplicitLocation(query: string): boolean {
  return EXPLICIT_LOCATION_PATTERNS.some((pattern) => pattern.test(query));
}

function detectIntent(query: string): SearchIntent {
  if (isLocationSensitiveQuery(query)) {
    return 'current-weather';
  }

  if (isSportsScoreQuery(query)) {
    return 'sports-score';
  }

  if (isMarketPriceQuery(query)) {
    return 'market-price';
  }

  return 'general';
}

function rewriteQuery(
  query: string,
  intent: SearchIntent,
  appliedLocationFallback: string | null,
): string {
  const normalizedQuery = query.replace(/[?!.]+$/g, '').trim();

  if (intent === 'current-weather' && appliedLocationFallback) {
    return `current weather and temperature right now in ${HARDCODED_FALLBACK_LOCATION}`;
  }

  if (
    intent === 'market-price' &&
    !/\b(current|latest|live|today|right now|quote)\b/i.test(query)
  ) {
    return `current live market price and latest quote: ${normalizedQuery}`;
  }

  if (
    intent === 'sports-score' &&
    !/\b(live score|latest result|final score|box score|scoreboard)\b/i.test(
      query,
    )
  ) {
    return `live score today, or if there is no live game the most recent result: ${normalizedQuery}`;
  }

  return query;
}

function buildExecutionHints(
  query: string,
  intent: SearchIntent,
  appliedLocationFallback: string | null,
): SearchExecutionHints {
  switch (intent) {
    case 'current-weather': {
      const hasRomaniaContext =
        appliedLocationFallback === HARDCODED_FALLBACK_LOCATION ||
        /\bbucharest\b/i.test(query) ||
        /\bromania\b/i.test(query);

      return {
        intent,
        exaUserLocation: hasRomaniaContext
          ? HARDCODED_FALLBACK_USER_LOCATION
          : null,
        exaCategory: null,
        tavilyCountry: hasRomaniaContext ? HARDCODED_FALLBACK_COUNTRY : null,
        tavilyTopic: 'general',
        excludeDomains: [...CURRENT_WEATHER_PREFERRED_EXCLUDE_DOMAINS],
        forceFreshContent: true,
      };
    }

    case 'market-price':
      return {
        intent,
        exaUserLocation: null,
        exaCategory: null,
        tavilyCountry: null,
        tavilyTopic: 'finance',
        excludeDomains: [],
        forceFreshContent: true,
      };

    case 'sports-score':
      return {
        intent,
        exaUserLocation: null,
        exaCategory: 'news',
        tavilyCountry: null,
        tavilyTopic: 'news',
        excludeDomains: [],
        forceFreshContent: true,
      };

    default:
      return {
        intent: 'general',
        exaUserLocation: null,
        exaCategory: null,
        tavilyCountry: null,
        tavilyTopic: 'general',
        excludeDomains: [],
        forceFreshContent: false,
      };
  }
}
