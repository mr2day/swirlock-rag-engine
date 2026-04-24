import type { SearchExecutionHints } from './search-query-resolver';
import type { NormalizedSearchResult } from './search.types';

type ResultRuleSet = {
  positivePatterns: RegExp[];
  negativePatterns: RegExp[];
  positiveUrlPatterns: RegExp[];
  negativeUrlPatterns: RegExp[];
};

const CURRENT_WEATHER_RULES: ResultRuleSet = {
  positivePatterns: [
    /\bcurrent weather\b/i,
    /\bweather conditions\b/i,
    /\bweather today\b/i,
    /\bright now\b/i,
    /\bcurrently\b/i,
    /\bfeels like\b/i,
    /\bhumidity\b/i,
    /\bwind\b/i,
    /\bnow\b/i,
  ],
  negativePatterns: [
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
  ],
  positiveUrlPatterns: [
    /current-weather/i,
    /weather-forecast\/now/i,
    /weather\/[^/]+\/[^/]+$/i,
    /timeanddate\.com\/weather/i,
  ],
  negativeUrlPatterns: [
    /monthly/i,
    /april-weather/i,
    /page=month/i,
    /history/i,
    /climate/i,
    /tenday/i,
  ],
};

const MARKET_PRICE_RULES: ResultRuleSet = {
  positivePatterns: [
    /\bcurrent price\b/i,
    /\blive price\b/i,
    /\bstock price\b/i,
    /\bshare price\b/i,
    /\blatest quote\b/i,
    /\bmarket price\b/i,
    /\btrading at\b/i,
    /\bpercent change\b/i,
    /\bmarket cap\b/i,
    /\bafter hours\b/i,
    /\bpre-market\b/i,
  ],
  negativePatterns: [
    /\bhistory\b/i,
    /\bhistorical\b/i,
    /\bforecast\b/i,
    /\bprediction\b/i,
    /\bprice target\b/i,
    /\banalysis\b/i,
    /\bopinion\b/i,
  ],
  positiveUrlPatterns: [
    /finance\.yahoo\.com\/quote/i,
    /marketwatch\.com\/investing/i,
    /tradingview\.com\/symbols/i,
    /coinmarketcap\.com\/currencies/i,
    /coingecko\.com\/en\/coins/i,
    /\/quote\//i,
    /\/stocks?\//i,
  ],
  negativeUrlPatterns: [
    /\/history/i,
    /historical/i,
    /\/forecast/i,
    /\/prediction/i,
    /\/analysis/i,
    /\/chart/i,
  ],
};

const SPORTS_SCORE_RULES: ResultRuleSet = {
  positivePatterns: [
    /\blive score\b/i,
    /\bfinal score\b/i,
    /\bbox score\b/i,
    /\bscoreboard\b/i,
    /\bmatch result\b/i,
    /\bgame result\b/i,
    /\bfull[- ]time\b/i,
    /\bhalftime\b/i,
    /\bfinal\b/i,
    /\bwon\b/i,
  ],
  negativePatterns: [
    /\bstandings\b/i,
    /\bschedule\b/i,
    /\bpreview\b/i,
    /\broster\b/i,
    /\bsquad\b/i,
    /\btable\b/i,
    /\bfixtures\b/i,
    /\btickets\b/i,
    /\bnews\b/i,
  ],
  positiveUrlPatterns: [
    /flashscore/i,
    /sofascore/i,
    /boxscore/i,
    /scoreboard/i,
    /gameid/i,
    /\/match\//i,
    /\/game\//i,
    /\/scores?\//i,
  ],
  negativeUrlPatterns: [
    /\/standings/i,
    /\/schedule/i,
    /\/roster/i,
    /\/preview/i,
    /\/tickets/i,
    /\/news\//i,
  ],
};

export function rankSearchResults(
  results: NormalizedSearchResult[],
  executionHints: SearchExecutionHints,
): NormalizedSearchResult[] {
  const rules = getRuleSet(executionHints);

  if (!rules) {
    return results;
  }

  return results
    .map((result, index) => ({
      result,
      index,
      rankScore: scoreResult(result, rules, executionHints),
    }))
    .sort((left, right) => {
      if (right.rankScore !== left.rankScore) {
        return right.rankScore - left.rankScore;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.result);
}

function getRuleSet(
  executionHints: SearchExecutionHints,
): ResultRuleSet | null {
  switch (executionHints.intent) {
    case 'current-weather':
      return CURRENT_WEATHER_RULES;
    case 'market-price':
      return MARKET_PRICE_RULES;
    case 'sports-score':
      return SPORTS_SCORE_RULES;
    default:
      return null;
  }
}

function scoreResult(
  result: NormalizedSearchResult,
  rules: ResultRuleSet,
  executionHints: SearchExecutionHints,
): number {
  const haystack =
    `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  let score = (result.score ?? 0) * 100;

  for (const pattern of rules.positivePatterns) {
    if (pattern.test(haystack)) {
      score += 18;
    }
  }

  for (const pattern of rules.negativePatterns) {
    if (pattern.test(haystack)) {
      score -= 26;
    }
  }

  for (const pattern of rules.positiveUrlPatterns) {
    if (pattern.test(result.url)) {
      score += 24;
    }
  }

  for (const pattern of rules.negativeUrlPatterns) {
    if (pattern.test(result.url)) {
      score -= 34;
    }
  }

  score += scoreRecency(result, executionHints.intent);
  score += scoreExplicitYears(haystack, executionHints.intent);

  return score;
}

function scoreRecency(
  result: NormalizedSearchResult,
  intent: SearchExecutionHints['intent'],
): number {
  if (!result.publishedAt) {
    return 0;
  }

  const publishedAt = new Date(result.publishedAt);

  if (Number.isNaN(publishedAt.getTime())) {
    return 0;
  }

  const ageDays = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);

  switch (intent) {
    case 'current-weather':
      if (ageDays <= 1) {
        return 28;
      }
      if (ageDays <= 7) {
        return 10;
      }
      if (ageDays > 90) {
        return -18;
      }
      return 0;

    case 'market-price':
      if (ageDays <= 1) {
        return 24;
      }
      if (ageDays <= 7) {
        return 8;
      }
      if (ageDays > 30) {
        return -20;
      }
      return 0;

    case 'sports-score':
      if (ageDays <= 3) {
        return 26;
      }
      if (ageDays <= 14) {
        return 10;
      }
      if (ageDays > 60) {
        return -22;
      }
      return 0;

    default:
      return 0;
  }
}

function scoreExplicitYears(
  haystack: string,
  intent: SearchExecutionHints['intent'],
): number {
  if (intent === 'general') {
    return 0;
  }

  const yearMatches = haystack.match(/\b20\d{2}\b/g);

  if (!yearMatches) {
    return 0;
  }

  const currentYear = new Date().getFullYear();
  let score = 0;

  for (const yearText of yearMatches) {
    const year = Number(yearText);

    if (Number.isNaN(year)) {
      continue;
    }

    if (year < currentYear - 1) {
      score -= 18;
    } else if (year === currentYear) {
      score += 6;
    }
  }

  return score;
}
