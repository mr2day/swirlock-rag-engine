import { Injectable } from '@nestjs/common';
import type { SearchIntent } from './search-query-resolver';
import { cleanContent } from './content-cleaner';

@Injectable()
export class ContentExcerptService {
  private readonly stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'for',
    'from',
    'how',
    'in',
    'is',
    'it',
    'now',
    'of',
    'on',
    'or',
    'outside',
    'that',
    'the',
    'this',
    'to',
    'was',
    'what',
    'when',
    'where',
    'with',
  ]);

  private readonly boilerplatePatterns = [
    /advertisement/i,
    /privacy\s*(policy|settings|legal|notice)/i,
    /privacy promise/i,
    /terms of use/i,
    /sign in/i,
    /cookie notice/i,
    /adchoices/i,
    /feedback/i,
    /careers/i,
    /newsletter/i,
    /follow us/i,
    /community guidelines/i,
    /all rights reserved/i,
    /copyright/i,
    /toggle navigation/i,
    /use current location/i,
    /recent locations/i,
    /learn more/i,
    /read more/i,
    /more information/i,
    /around the globe/i,
    /top stories/i,
    /featured stories/i,
    /trending (now|today)/i,
    /news & features/i,
    /for business/i,
    /no results found/i,
    /weather near/i,
    /contact us/i,
    /subscription services/i,
    /weather history/i,
    /historical data/i,
  ];

  buildExcerpt(
    content: string,
    query: string,
    intent: SearchIntent = 'general',
  ): string {
    const cleanedContent = cleanContent(content);
    const blocks = this.extractCandidateBlocks(cleanedContent);

    if (blocks.length === 0) {
      return this.fallbackExcerpt(cleanedContent);
    }

    const queryTerms = this.extractQueryTerms(query);
    const rankedBlocks = blocks
      .map((block, index) => ({
        block,
        index,
        score: this.scoreBlock(block, queryTerms, intent),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    if (rankedBlocks.length === 0) {
      return this.fallbackExcerpt(cleanedContent);
    }

    const selectedBlocks = rankedBlocks
      .slice(0, 3)
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.block);

    return this.limitExcerpt(selectedBlocks.join(' '), 900);
  }

  private extractCandidateBlocks(content: string): string[] {
    return content
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter((block) => block.length >= 40)
      .filter((block) => !this.isMostlyBoilerplate(block))
      .slice(0, 120);
  }

  private isMostlyBoilerplate(block: string): boolean {
    const lower = block.toLowerCase();

    if (this.boilerplatePatterns.some((pattern) => pattern.test(block))) {
      return true;
    }

    const words = lower.split(/\s+/).filter(Boolean);
    const uniqueWords = new Set(words);
    const uniqueRatio = words.length > 0 ? uniqueWords.size / words.length : 0;

    if (words.length > 12 && uniqueRatio < 0.42) {
      return true;
    }

    const shortTokenRatio =
      words.length > 0
        ? words.filter((word) => word.length <= 3).length / words.length
        : 0;

    return shortTokenRatio > 0.55 && words.length < 30;
  }

  private extractQueryTerms(query: string): string[] {
    return query
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3)
      .filter((term) => !this.stopWords.has(term));
  }

  private scoreBlock(
    block: string,
    queryTerms: string[],
    intent: SearchIntent,
  ): number {
    const lower = block.toLowerCase();
    const wordCount = block.split(/\s+/).filter(Boolean).length;

    if (wordCount < 8) {
      return -10;
    }

    let score = 0;

    if (wordCount >= 14 && wordCount <= 120) {
      score += 12;
    } else if (wordCount <= 220) {
      score += 6;
    }

    if (/[.!?]/.test(block)) {
      score += 6;
    }

    score += this.scoreIntentSignals(lower, intent);

    if (queryTerms.length > 0) {
      score += queryTerms.reduce((total, term) => {
        const matches = lower.match(
          new RegExp(`\\b${this.escapeForRegex(term)}\\b`, 'g'),
        );

        return total + (matches ? matches.length * 5 : 0);
      }, 0);
    }

    const uppercaseRatio =
      block.length > 0
        ? (block.match(/[A-Z]/g)?.length ?? 0) / block.length
        : 0;

    if (uppercaseRatio > 0.25) {
      score -= 6;
    }

    const colonCount = block.match(/:/g)?.length ?? 0;

    if (colonCount > 6) {
      score -= 4;
    }

    if (
      block.length < 500 &&
      !/[.!?]/.test(block) &&
      !/\b(current|temperature|humidity|wind|forecast|price|score|result)\b/i.test(
        lower,
      )
    ) {
      score -= 8;
    }

    return score;
  }

  private scoreIntentSignals(lower: string, intent: SearchIntent): number {
    switch (intent) {
      case 'current-weather':
        return this.scoreCurrentWeatherSignals(lower);
      case 'market-price':
        return this.scoreMarketPriceSignals(lower);
      case 'sports-score':
        return this.scoreSportsScoreSignals(lower);
      default:
        return 0;
    }
  }

  private scoreCurrentWeatherSignals(lower: string): number {
    let score = 0;

    if (
      /\b\d+(?:\.\d+)?\s?(?:\u00b0|deg(?:rees)?|f|c|mph|km\/h|kt|%|mb|hpa|in)\b/i.test(
        lower,
      )
    ) {
      score += 18;
    }

    if (
      /\b(current weather|current weather conditions|humidity|temperature|feels like|realfeel|wind|dew point|pressure|visibility|cloud cover)\b/i.test(
        lower,
      )
    ) {
      score += 24;
    }

    if (
      /\b(currently|temperature of|realfeel|humidity|dew point|visibility|partly sunny|mostly cloudy|sunny|clear)\b/i.test(
        lower,
      )
    ) {
      score += 18;
    }

    if (/\b(today|tonight|hourly|daily|now|last update|as of)\b/i.test(lower)) {
      score += 8;
    }

    if (
      /\b(wildfire|tornado|astronomy|travel|sports|business|climate|health|featured stories|top stories|trending|newsletter)\b/i.test(
        lower,
      )
    ) {
      score -= 18;
    }

    if (
      /\b(history|historical|april 2026|may 2026|january|february)\b/i.test(
        lower,
      )
    ) {
      score -= 20;
    }

    if (
      /\b(weather channel is the world's most accurate forecaster|accuweather founder|download app)\b/i.test(
        lower,
      )
    ) {
      score -= 24;
    }

    return score;
  }

  private scoreMarketPriceSignals(lower: string): number {
    let score = 0;

    if (
      /\b(current price|live price|stock price|share price|market price|latest quote|market cap|percent change|trading at|day range|open|high|low|volume|bid|ask)\b/i.test(
        lower,
      )
    ) {
      score += 24;
    }

    if (
      /\b(usd|eur|ron|gbp|jpy|btc|eth|crypto|cryptocurrency|exchange rate|forex|nasdaq|nyse|after hours|pre-market)\b/i.test(
        lower,
      ) ||
      /[$\u20ac\u00a3\u00a5]/.test(lower)
    ) {
      score += 18;
    }

    if (
      /\b(currently|today|right now|as of|market open|market close)\b/i.test(
        lower,
      )
    ) {
      score += 8;
    }

    if (
      /\b(history|historical|forecast|prediction|price target|analysis|opinion|long-term)\b/i.test(
        lower,
      )
    ) {
      score -= 22;
    }

    return score;
  }

  private scoreSportsScoreSignals(lower: string): number {
    let score = 0;

    if (
      /\b(live score|final score|box score|scoreboard|match result|game result|full[- ]time|halftime|quarter|period|innings|set point|goals?|points?|runs?|beats?|defeated|wins?)\b/i.test(
        lower,
      )
    ) {
      score += 24;
    }

    if (
      /\b(game|match|vs|versus|nba|wnba|nfl|mlb|nhl|epl|uefa|champions league|premier league|laliga|la liga|serie a|bundesliga|soccer|football|basketball|baseball|hockey|tennis)\b/i.test(
        lower,
      )
    ) {
      score += 18;
    }

    if (/\b(today|tonight|live|final|kickoff|as of)\b/i.test(lower)) {
      score += 8;
    }

    if (
      /\b(standings|schedule|preview|roster|squad|table|fixtures|tickets|news)\b/i.test(
        lower,
      )
    ) {
      score -= 20;
    }

    return score;
  }

  private fallbackExcerpt(content: string): string {
    if (!content) {
      return 'No extracted content returned.';
    }

    return this.limitExcerpt(content, 900);
  }

  private limitExcerpt(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    return `${content.slice(0, maxLength - 3).trimEnd()}...`;
  }

  private escapeForRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
