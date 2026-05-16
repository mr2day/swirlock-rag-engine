import { Injectable, Logger } from '@nestjs/common';
import { UtilityLlmService } from './utility-llm.service';

export interface DistillationSource {
  index: number;
  title: string;
  url: string;
  publishedAt: string | null;
  content: string;
}

export interface DistillationResult {
  preparedPrompt: string;
  durationMs: number;
  model: string | null;
}

const EXTRACTION_INSTRUCTION = `You are the search-distillation step of a chatbot pipeline. Your job is to read web pages that were returned for a user's query and write a prose answer-aid for a downstream conversational model that will speak to the user.

Rules:
- Use ONLY facts visibly present in the sources. Do not add facts from your own knowledge.
- If sources disagree, say who says what (e.g. "Source 1 says A; Source 3 says B"). Do not pick a winner.
- If a fact is partially visible (e.g. a schedule that cuts off mid-page, a list that is truncated, a sentence that ends in "[...]"), say what you can see and explicitly flag the cutoff. Truncation is NOT evidence of absence — never assert a negative just because something isn't visible in a snippet.
- If a source contains sidebars, recommendation widgets, navigation links, or cross-page suggestions that are not the page's main subject, ignore them and briefly note this. They are not the page's actual content.
- If the user's question cannot be answered from the sources, say so plainly — do not invent.
- Do not include URLs in the prose. Refer to sources by their numbered tag (e.g. "according to Source 2").
- Write in the same language as the user's query when natural.
- Be concise. Aim for a few short paragraphs. The downstream model will rewrite this into a conversational reply.

Output format — exactly two sections:

PREPARED_PROMPT:
<your prose answer-aid here>

NOTES:
<optional one-line observations about source quality, ignored widgets, truncation issues — or empty if nothing notable>
`;

@Injectable()
export class DistillationService {
  private readonly log = new Logger(DistillationService.name);

  constructor(private readonly utilityLlm: UtilityLlmService) {}

  isEnabled(): boolean {
    return this.utilityLlm.isEnabled();
  }

  async distill(
    query: string,
    sources: DistillationSource[],
    correlationId: string,
  ): Promise<DistillationResult | null> {
    if (!this.utilityLlm.isEnabled() || sources.length === 0) {
      return null;
    }

    const startedAt = Date.now();
    const userMessage = this.buildUserMessage(query, sources);

    try {
      const text = await this.utilityLlm.infer({
        correlationId,
        messages: [
          { role: 'system', content: EXTRACTION_INSTRUCTION },
          { role: 'user', content: userMessage },
        ],
      });
      const preparedPrompt = this.extractPreparedPrompt(text);
      const durationMs = Date.now() - startedAt;
      this.log.log(
        `[${correlationId}] distillation completed in ${durationMs}ms (${sources.length} source(s), preparedPrompt=${preparedPrompt.length} chars)`,
      );
      return {
        preparedPrompt,
        durationMs,
        model: this.utilityLlm.getCachedModelId(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(
        `[${correlationId}] distillation failed after ${Date.now() - startedAt}ms: ${message}`,
      );
      return null;
    }
  }

  private buildUserMessage(
    query: string,
    sources: DistillationSource[],
  ): string {
    const lines: string[] = [];
    lines.push(`User question / search query: ${query}`);
    lines.push('');
    lines.push(`Below are ${sources.length} web pages.`);
    lines.push('');
    for (const source of sources) {
      const publishedAttr = source.publishedAt
        ? ` publishedAt="${source.publishedAt}"`
        : '';
      lines.push(
        `<source id="${source.index}" title="${escapeAttr(source.title)}" url="${escapeAttr(source.url)}"${publishedAttr}>`,
      );
      lines.push(source.content);
      lines.push(`</source>`);
      lines.push('');
    }
    return lines.join('\n');
  }

  private extractPreparedPrompt(rawOutput: string): string {
    const text = rawOutput ?? '';
    const preparedMatch = text.match(/PREPARED_PROMPT:\s*([\s\S]*?)(?:\nNOTES:|$)/i);
    if (preparedMatch) {
      return preparedMatch[1].trim();
    }
    return text.trim();
  }
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}
