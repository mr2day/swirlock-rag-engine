import type { SearchExecutionHints } from './search-query-resolver';
import type { NormalizedSearchResult } from './search.types';

const CURRENT_WEATHER_POSITIVE_PATTERNS = [
  /\bcurrent weather\b/i,
  /\bweather conditions\b/i,
  /\bweather today\b/i,
  /\bright now\b/i,
  /\bcurrently\b/i,
  /\bfeels like\b/i,
  /\bhumidity\b/i,
  /\bwind\b/i,
  /\bnow\b/i,
];

const CURRENT_WEATHER_NEGATIVE_PATTERNS = [
  /\bmonthly\b/i,
  /\bmonth\b/i,
  /\bhistory\b/i,
  /\bhistorical\b/i,
  /\bclimate\b/i,
  /\bapril\b/i,
  /\bmay\b/i,
  /\bjanuary\b/i,
  /\bfebruary\b/i,
  /\b10-day\b/i,
  /\b14-day\b/i,
  /\btenday\b/i,
];

const CURRENT_WEATHER_POSITIVE_URL_PATTERNS = [
  /current-weather/i,
  /weather-forecast\/now/i,
  /weather\/[^/]+\/[^/]+$/i,
  /timeanddate\.com\/weather/i,
];

const CURRENT_WEATHER_NEGATIVE_URL_PATTERNS = [
  /monthly/i,
  /april-weather/i,
  /page=month/i,
  /history/i,
  /climate/i,
  /tenday/i,
];

export function rankSearchResults(
  results: NormalizedSearchResult[],
  executionHints: SearchExecutionHints,
): NormalizedSearchResult[] {
  if (executionHints.intent !== 'current-weather') {
    return results;
  }

  return results
    .map((result, index) => ({
      result,
      index,
      rankScore: scoreCurrentWeatherResult(result),
    }))
    .sort((left, right) => {
      if (right.rankScore !== left.rankScore) {
        return right.rankScore - left.rankScore;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.result);
}

function scoreCurrentWeatherResult(result: NormalizedSearchResult): number {
  const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  let score = (result.score ?? 0) * 100;

  for (const pattern of CURRENT_WEATHER_POSITIVE_PATTERNS) {
    if (pattern.test(haystack)) {
      score += 18;
    }
  }

  for (const pattern of CURRENT_WEATHER_NEGATIVE_PATTERNS) {
    if (pattern.test(haystack)) {
      score -= 26;
    }
  }

  for (const pattern of CURRENT_WEATHER_POSITIVE_URL_PATTERNS) {
    if (pattern.test(result.url)) {
      score += 24;
    }
  }

  for (const pattern of CURRENT_WEATHER_NEGATIVE_URL_PATTERNS) {
    if (pattern.test(result.url)) {
      score -= 34;
    }
  }

  return score;
}
