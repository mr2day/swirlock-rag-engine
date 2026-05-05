import { Logger } from '@nestjs/common';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { RetrievalService } from './retrieval.service';
import type { RetrievalStreamEvent } from './retrieval.types';

const RETRIEVAL_STREAM_PATH = '/v2/retrieval/evidence/stream';
const FIRST_MESSAGE_TIMEOUT_MS = 30_000;

interface RetrieveEvidenceStreamMessage {
  type?: unknown;
  correlationId?: unknown;
  request?: unknown;
}

function rawToString(raw: WebSocket.RawData): string {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
}

function firstHeaderValue(value: IncomingMessage['headers'][string]): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return '';
}

export function attachRetrievalStreamServer(
  httpServer: HttpServer,
  retrievalService: RetrievalService,
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
      void handleRetrievalStream(ws, req, retrievalService, log).catch(
        (error: Error) => {
          log.error(`stream handler crashed: ${error.message}`, error.stack);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        },
      );
    });
  });
}

async function handleRetrievalStream(
  ws: WebSocket,
  req: IncomingMessage,
  retrievalService: RetrievalService,
  log: Logger,
): Promise<void> {
  const headerCorrelationId = firstHeaderValue(
    req.headers['x-correlation-id'],
  ).trim();

  let message: RetrieveEvidenceStreamMessage;
  try {
    message = await readFirstMessage(ws);
  } catch (error) {
    sendFailed(ws, 1, error instanceof Error ? error.message : String(error));
    closeQuietly(ws);
    return;
  }

  if (
    message.type !== 'retrieve_evidence' ||
    !message.request ||
    typeof message.request !== 'object'
  ) {
    sendFailed(
      ws,
      1,
      'first message must be { type: "retrieve_evidence", correlationId, request }',
    );
    closeQuietly(ws);
    return;
  }

  const correlationId =
    typeof message.correlationId === 'string' && message.correlationId.trim()
      ? message.correlationId.trim()
      : headerCorrelationId;

  if (!correlationId) {
    sendFailed(ws, 1, 'correlationId is required.');
    closeQuietly(ws);
    return;
  }

  let lastSequence = 0;
  try {
    await retrievalService.retrieveEvidence(
      message.request,
      correlationId,
      (event) => {
        lastSequence = event.sequence;
        sendEvent(ws, event);
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`[${correlationId}] retrieval stream failed: ${message}`);
    sendFailed(ws, lastSequence + 1, message);
  } finally {
    closeQuietly(ws);
  }
}

function readFirstMessage(
  ws: WebSocket,
): Promise<RetrieveEvidenceStreamMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('no retrieve_evidence message received within timeout'));
    }, FIRST_MESSAGE_TIMEOUT_MS);

    const onMessage = (raw: WebSocket.RawData): void => {
      cleanup();
      try {
        resolve(JSON.parse(rawToString(raw)) as RetrieveEvidenceStreamMessage);
      } catch {
        reject(new Error('first message must be JSON'));
      }
    };
    const onClose = (): void => {
      cleanup();
      reject(
        new Error('client closed connection before sending retrieve_evidence'),
      );
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      ws.off('message', onMessage);
      ws.off('close', onClose);
    };

    ws.once('message', onMessage);
    ws.once('close', onClose);
  });
}

function sendEvent(ws: WebSocket, event: RetrievalStreamEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function sendFailed(ws: WebSocket, sequence: number, message: string): void {
  sendEvent(ws, {
    type: 'retrieval.failed',
    sequence,
    occurredAt: new Date().toISOString(),
    data: { message },
  });
}

function closeQuietly(ws: WebSocket): void {
  try {
    ws.close();
  } catch {
    /* ignore */
  }
}
