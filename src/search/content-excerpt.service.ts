import { Injectable } from '@nestjs/common';
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
    /advertisement/gi,
    /privacy\s*(policy|settings|legal|notice)/gi,
    /terms of use/gi,
    /sign in/gi,
    /cookie notice/gi,
    /adchoices/gi,
    /feedback/gi,
    /careers/gi,
    /newsletter/gi,
    /follow us/gi,
    /community guidelines/gi,
    /all rights reserved/gi,
    /copyright/gi,
    /toggle navigation/gi,
    /use current location/gi,
    /recent locations/gi,
    /learn more/gi,
    /read more/gi,
    /more information/gi,
  ];

  buildExcerpt(content: string, query: string): string {
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
        score: this.scoreBlock(block, queryTerms),
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

    return this.limitExcerpt(selectedBlocks.join(' '), 1200);
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

  private scoreBlock(block: string, queryTerms: string[]): number {
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

    if (/\b\d+\s?(°|°f|°c|f|c|mph|km\/h|%|mb|in)\b/i.test(lower)) {
      score += 16;
    }

    if (/\b(current weather|forecast|humidity|temperature|feels like|wind|dew point|pressure|visibility)\b/i.test(lower)) {
      score += 14;
    }

    if (/\b(today|tonight|hourly|daily|now|last update|as of)\b/i.test(lower)) {
      score += 8;
    }

    if (queryTerms.length > 0) {
      score += queryTerms.reduce((total, term) => {
        const matches = lower.match(new RegExp(`\\b${this.escapeForRegex(term)}\\b`, 'g'));

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

    const colonCount = (block.match(/:/g)?.length ?? 0);

    if (colonCount > 6) {
      score -= 4;
    }

    return score;
  }

  private fallbackExcerpt(content: string): string {
    if (!content) {
      return 'No extracted content returned.';
    }

    return this.limitExcerpt(content, 1200);
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
