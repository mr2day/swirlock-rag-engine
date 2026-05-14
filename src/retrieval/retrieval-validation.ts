import { BadRequestException } from '@nestjs/common';
import { isIsoUtcTimestamp } from '../common/api-envelope';
import type {
  SearchRunRequest,
  ValidatedSearchRunRequest,
} from './search-run.types';
import type {
  InputPart,
  RequestPriority,
  RetrieveEvidenceRequest,
  RetrievalAllowedMode,
  RetrievalFreshness,
  RetrievalHint,
  TextInputPart,
  UserLocation,
  ValidatedRetrieveEvidenceRequest,
} from './retrieval.types';

const PRIORITIES: RequestPriority[] = [
  'interactive',
  'background',
  'maintenance',
];
const FRESHNESS_VALUES: RetrievalFreshness[] = [
  'low',
  'medium',
  'high',
  'realtime',
];
const ALLOWED_MODES: RetrievalAllowedMode[] = ['local_rag', 'live_web'];
const HINT_KINDS: RetrievalHint['kind'][] = [
  'entity',
  'time_reference',
  'preference',
  'disambiguation',
  'constraint',
];

export function validateRetrieveEvidenceRequest(
  value: unknown,
  maxEvidenceChunks: number,
): ValidatedRetrieveEvidenceRequest {
  const request = expectObject(
    value,
    'request body',
  ) as unknown as RetrieveEvidenceRequest;

  validateRequestContext(request.requestContext);

  if (!request.query || typeof request.query !== 'object') {
    throw validationError('query is required.');
  }

  const query = request.query;

  if (!Array.isArray(query.parts) || query.parts.length === 0) {
    throw validationError('query.parts must contain at least one input part.');
  }

  const parts = query.parts.map(validateInputPart);
  const freshness = expectEnum(
    query.freshness,
    FRESHNESS_VALUES,
    'query.freshness',
  );
  if (query.allowedModes !== undefined && !Array.isArray(query.allowedModes)) {
    throw validationError('query.allowedModes must be an array when provided.');
  }

  if (query.hints !== undefined && !Array.isArray(query.hints)) {
    throw validationError('query.hints must be an array when provided.');
  }

  const allowedModes =
    query.allowedModes === undefined
      ? [...ALLOWED_MODES]
      : query.allowedModes.map((mode, index) =>
          expectEnum(mode, ALLOWED_MODES, `query.allowedModes[${index}]`),
        );
  const requestedMaxEvidenceChunks = query.maxEvidenceChunks ?? 8;

  if (
    !Number.isInteger(requestedMaxEvidenceChunks) ||
    requestedMaxEvidenceChunks < 1
  ) {
    throw validationError('query.maxEvidenceChunks must be an integer >= 1.');
  }

  const userLocation = validateOptionalUserLocation(query.userLocation);
  const hints = query.hints ? query.hints.map(validateRetrievalHint) : [];

  return {
    ...request,
    query: {
      ...query,
      parts,
      hints,
      freshness,
      allowedModes: [...new Set(allowedModes)],
      maxEvidenceChunks: Math.min(
        requestedMaxEvidenceChunks,
        maxEvidenceChunks,
      ),
      ...(userLocation ? { userLocation } : {}),
    },
  };
}

function validateOptionalUserLocation(value: unknown): UserLocation | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(
      'query.userLocation must be an object when provided.',
    );
  }

  const record = value as Record<string, unknown>;
  const latitude = record.latitude;
  const longitude = record.longitude;

  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
    throw validationError(
      'query.userLocation.latitude must be a finite number.',
    );
  }
  if (latitude < -90 || latitude > 90) {
    throw validationError(
      'query.userLocation.latitude must be between -90 and 90.',
    );
  }
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
    throw validationError(
      'query.userLocation.longitude must be a finite number.',
    );
  }
  if (longitude < -180 || longitude > 180) {
    throw validationError(
      'query.userLocation.longitude must be between -180 and 180.',
    );
  }

  const result: UserLocation = { latitude, longitude };

  if (record.accuracyMeters !== undefined) {
    if (
      typeof record.accuracyMeters !== 'number' ||
      !Number.isFinite(record.accuracyMeters) ||
      record.accuracyMeters < 0
    ) {
      throw validationError(
        'query.userLocation.accuracyMeters must be a non-negative finite number when provided.',
      );
    }
    result.accuracyMeters = record.accuracyMeters;
  }

  if (record.capturedAt !== undefined) {
    if (
      typeof record.capturedAt !== 'string' ||
      Number.isNaN(Date.parse(record.capturedAt))
    ) {
      throw validationError(
        'query.userLocation.capturedAt must be an ISO 8601 timestamp string when provided.',
      );
    }
    result.capturedAt = record.capturedAt;
  }

  return result;
}

const SEARCH_RUN_EXTRACT_LIMIT_MIN = 1;
const SEARCH_RUN_EXTRACT_LIMIT_MAX = 5;
const SEARCH_RUN_EXTRACT_LIMIT_DEFAULT = 2;

export function validateSearchRunRequest(
  value: unknown,
): ValidatedSearchRunRequest {
  const request = expectObject(value, 'request body') as unknown as SearchRunRequest;

  validateRequestContext(request.requestContext);

  if (!request.query || typeof request.query !== 'object') {
    throw validationError('query is required.');
  }

  const query = request.query;
  const queryText =
    typeof query.queryText === 'string' ? query.queryText.trim() : '';
  if (!queryText) {
    throw validationError('query.queryText is required.');
  }

  let extractLimit = SEARCH_RUN_EXTRACT_LIMIT_DEFAULT;
  if (query.extractLimit !== undefined) {
    if (
      !Number.isInteger(query.extractLimit) ||
      query.extractLimit < SEARCH_RUN_EXTRACT_LIMIT_MIN ||
      query.extractLimit > SEARCH_RUN_EXTRACT_LIMIT_MAX
    ) {
      throw validationError(
        `query.extractLimit must be an integer between ${SEARCH_RUN_EXTRACT_LIMIT_MIN} and ${SEARCH_RUN_EXTRACT_LIMIT_MAX}.`,
      );
    }
    extractLimit = query.extractLimit;
  }

  const freshness =
    query.freshness === undefined
      ? 'medium'
      : expectEnum(query.freshness, FRESHNESS_VALUES, 'query.freshness');

  return {
    requestContext: request.requestContext,
    query: {
      queryText,
      extractLimit,
      freshness,
    },
  };
}

export function assertCorrelationId(
  correlationId: string | undefined,
): asserts correlationId is string {
  if (!correlationId?.trim()) {
    throw validationError('x-correlation-id header is required.');
  }
}

function validateRequestContext(
  context: RetrieveEvidenceRequest['requestContext'],
): void {
  if (!context || typeof context !== 'object') {
    throw validationError('requestContext is required.');
  }

  if (!context.callerService?.trim()) {
    throw validationError('requestContext.callerService is required.');
  }

  expectEnum(context.priority, PRIORITIES, 'requestContext.priority');

  if (
    typeof context.requestedAt !== 'string' ||
    !isIsoUtcTimestamp(context.requestedAt)
  ) {
    throw validationError(
      'requestContext.requestedAt must be an ISO 8601 UTC timestamp.',
    );
  }

  if (
    context.timeoutMs !== undefined &&
    (!Number.isInteger(context.timeoutMs) || context.timeoutMs < 1)
  ) {
    throw validationError('requestContext.timeoutMs must be an integer >= 1.');
  }
}

function validateInputPart(part: unknown, index: number): InputPart {
  const inputPart = expectObject(
    part,
    `query.parts[${index}]`,
  ) as unknown as InputPart;

  if (inputPart.type === 'text') {
    return validateTextPart(inputPart, index);
  }

  throw validationError(`query.parts[${index}].type must be text.`);
}

function validateTextPart(part: TextInputPart, index: number): TextInputPart {
  if (typeof part.text !== 'string' || !part.text.trim()) {
    throw validationError(`query.parts[${index}].text is required.`);
  }

  return {
    type: 'text',
    text: part.text.trim(),
  };
}

function validateRetrievalHint(hint: unknown, index: number): RetrievalHint {
  const retrievalHint = expectObject(
    hint,
    `query.hints[${index}]`,
  ) as unknown as RetrievalHint;

  const kind = expectEnum(
    retrievalHint.kind,
    HINT_KINDS,
    `query.hints[${index}].kind`,
  );

  if (typeof retrievalHint.text !== 'string' || !retrievalHint.text.trim()) {
    throw validationError(`query.hints[${index}].text is required.`);
  }

  return {
    kind,
    text: retrievalHint.text.trim(),
  };
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function expectEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw validationError(`${label} must be one of: ${allowed.join(', ')}.`);
  }

  return value as T;
}

function validationError(message: string): BadRequestException {
  return new BadRequestException({
    message,
    details: {},
  });
}
