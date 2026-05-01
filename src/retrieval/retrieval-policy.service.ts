import { Injectable } from '@nestjs/common';
import type {
  RetrievalAllowedMode,
  RetrievalFreshness,
  RetrievalMode,
} from './retrieval.types';

export interface RetrievalPolicyInput {
  allowedModes: RetrievalAllowedMode[];
  freshness: RetrievalFreshness;
  localResultCount: number;
  hasSearchableText: boolean;
  hasImageInput: boolean;
}

export interface RetrievalPolicyDecision {
  mode: RetrievalMode;
  useLocal: boolean;
  useLive: boolean;
  reason: string;
}

@Injectable()
export class RetrievalPolicyService {
  decide(input: RetrievalPolicyInput): RetrievalPolicyDecision {
    const allowsLocal = input.allowedModes.includes('local_rag');
    const allowsLive = input.allowedModes.includes('live_web');
    const hasLocalCoverage = input.localResultCount > 0;

    if (!input.hasSearchableText) {
      return {
        mode: allowsLocal ? 'local_rag' : 'none',
        useLocal: allowsLocal,
        useLive: false,
        reason: input.hasImageInput
          ? 'Image input was received, but phase-one retrieval needs text or utility-model image observations before live web search.'
          : 'No searchable retrieval text was provided.',
      };
    }

    if (!allowsLocal && !allowsLive) {
      return {
        mode: 'none',
        useLocal: false,
        useLive: false,
        reason: 'No retrieval modes were allowed by the caller.',
      };
    }

    if (input.freshness === 'realtime' || input.freshness === 'high') {
      if (allowsLive && allowsLocal && hasLocalCoverage) {
        return {
          mode: 'local_and_live',
          useLocal: true,
          useLive: true,
          reason:
            'Freshness requirement is high, and local cache has potentially useful supporting evidence.',
        };
      }

      if (allowsLive) {
        return {
          mode: 'live_web',
          useLocal: false,
          useLive: true,
          reason:
            'Freshness requirement is high, so live web retrieval is preferred.',
        };
      }
    }

    if (allowsLocal && hasLocalCoverage && input.freshness === 'low') {
      return {
        mode: 'local_rag',
        useLocal: true,
        useLive: false,
        reason:
          'Low freshness requirement and local cache coverage is available.',
      };
    }

    if (allowsLocal && hasLocalCoverage && !allowsLive) {
      return {
        mode: 'local_rag',
        useLocal: true,
        useLive: false,
        reason: 'Caller restricted retrieval to local knowledge.',
      };
    }

    if (allowsLocal && hasLocalCoverage && allowsLive) {
      return {
        mode: 'local_and_live',
        useLocal: true,
        useLive: true,
        reason:
          'Local evidence exists, and live web can improve coverage for this query.',
      };
    }

    if (allowsLive) {
      return {
        mode: 'live_web',
        useLocal: false,
        useLive: true,
        reason:
          'Local cache had no useful hits, so live web retrieval is needed.',
      };
    }

    return {
      mode: 'local_rag',
      useLocal: allowsLocal,
      useLive: false,
      reason:
        'Caller restricted retrieval to local knowledge, but the local cache had no useful hits.',
    };
  }
}
