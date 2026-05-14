import { Logger } from '@nestjs/common';
import type { Server as HttpServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { validateSearchRunRequest } from './retrieval-validation';
import { RetrievalService } from './retrieval.service';
import type { RetrievalStreamEvent } from './retrieval.types';
import { SearchRunService } from './search-run.service';

const RETRIEVAL_STREAM_PATH = '/v5/retrieval';

interface V4Envelope {
  type: string;
  correlationId: string;
  payload?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

function rawToString(raw: WebSocket.RawData): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

export function attachRetrievalStreamServer(
  httpServer: HttpServer,
  retrievalService: RetrievalService,
  searchRunService: SearchRunService,
): void {
  const wss = new WebSocketServer({ noServer: true });
  const log = new Logger('RetrievalStream');

  httpServer.on('upgrade', (req, socket, head) => {
    const pathOnly = (req.url ?? '').split('?')[0];
    if (pathOnly !== RETRIEVAL_STREAM_PATH) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleRetrievalSocket(ws, retrievalService, searchRunService, log);
    });
  });
}

function handleRetrievalSocket(
  ws: WebSocket,
  retrievalService: RetrievalService,
  searchRunService: SearchRunService,
  log: Logger,
): void {
  ws.on('message', (raw: WebSocket.RawData) => {
    void handleMessage(ws, raw, retrievalService, searchRunService, log);
  });
}

async function handleMessage(
  ws: WebSocket,
  raw: WebSocket.RawData,
  retrievalService: RetrievalService,
  searchRunService: SearchRunService,
  log: Logger,
): Promise<void> {
  let correlationId = 'missing-correlation-id';

  try {
    const message = parseEnvelope(raw);
    correlationId = message.correlationId;

    if (message.type === 'heartbeat') {
      sendEnvelope(ws, {
        type: 'heartbeat',
        correlationId,
        payload: { receivedAt: new Date().toISOString() },
      });
      return;
    }

    if (message.type === 'cancel') {
      return;
    }

    if (message.type === 'health.get') {
      sendEnvelope(ws, {
        type: 'health',
        correlationId,
        payload: {
          status: 'ok',
          ready: true,
          checkedAt: new Date().toISOString(),
        },
      });
      return;
    }

    if (message.type === 'search.run') {
      const rawRequest = isRecord(message.payload)
        ? message.payload.request
        : undefined;
      if (!isRecord(rawRequest)) {
        sendError(
          ws,
          correlationId,
          'validation_failed',
          'payload.request is required.',
          false,
        );
        return;
      }

      let validated;
      try {
        validated = validateSearchRunRequest(rawRequest);
      } catch (err) {
        const validationMessage =
          err instanceof Error ? err.message : String(err);
        sendError(
          ws,
          correlationId,
          'validation_failed',
          validationMessage,
          false,
        );
        return;
      }

      const data = await searchRunService.run(validated, correlationId);
      sendEnvelope(ws, {
        type: 'search.completed',
        correlationId,
        payload: {
          sequence: 1,
          occurredAt: new Date().toISOString(),
          data,
        },
      });
      return;
    }

    if (message.type !== 'retrieve_evidence') {
      sendError(
        ws,
        correlationId,
        'validation_failed',
        'type must be retrieve_evidence, search.run, health.get, cancel, or heartbeat.',
        false,
      );
      return;
    }

    const request = isRecord(message.payload)
      ? message.payload.request
      : undefined;
    if (!isRecord(request)) {
      sendError(
        ws,
        correlationId,
        'validation_failed',
        'payload.request is required.',
        false,
      );
      return;
    }

    let lastSequence = 0;
    await retrievalService.retrieveEvidence(request, correlationId, (event) => {
      lastSequence = event.sequence;
      sendRetrievalEvent(ws, correlationId, event);
    });

    void lastSequence;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[${correlationId}] retrieval stream failed: ${message}`);
    sendError(ws, correlationId, 'internal_error', message, true);
  }
}

function parseEnvelope(raw: WebSocket.RawData): V4Envelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawToString(raw));
  } catch {
    throw new Error('WebSocket message must be valid JSON.');
  }

  if (!isRecord(parsed)) {
    throw new Error('WebSocket message must be an object.');
  }

  if (typeof parsed.type !== 'string' || !parsed.type.trim()) {
    throw new Error('type is required.');
  }

  if (
    typeof parsed.correlationId !== 'string' ||
    !parsed.correlationId.trim()
  ) {
    throw new Error('correlationId is required.');
  }

  return {
    type: parsed.type.trim(),
    correlationId: parsed.correlationId.trim(),
    payload: isRecord(parsed.payload) ? parsed.payload : undefined,
  };
}

function sendRetrievalEvent(
  ws: WebSocket,
  correlationId: string,
  event: RetrievalStreamEvent,
): void {
  sendEnvelope(ws, {
    type: event.type,
    correlationId,
    payload: {
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      data: event.data,
    },
  });
}

function sendEnvelope(ws: WebSocket, event: V4Envelope): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function sendError(
  ws: WebSocket,
  correlationId: string,
  code: string,
  message: string,
  retryable: boolean,
): void {
  sendEnvelope(ws, {
    type: 'error',
    correlationId,
    error: { code, message, retryable },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
