import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createApiMeta } from './api-envelope';

const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REQUEST_TIMEOUT: 408,
  TOO_MANY_REQUESTS: 429,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  INTERNAL_SERVER_ERROR: 500,
} as const;

type ErrorResponseBody =
  | string
  | {
      message?: string | string[];
      error?: string;
      statusCode?: number;
      details?: Record<string, unknown>;
    };

@Catch()
export class ContractExceptionFilter implements ExceptionFilter {
  constructor(private readonly apiVersion = 'v2') {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException
        ? (exception.getResponse() as ErrorResponseBody)
        : null;
    const message = this.extractMessage(body, exception);
    const details =
      typeof body === 'object' && body?.details ? body.details : {};

    response.status(status).json({
      meta: createApiMeta(
        this.getHeaderValue(request.headers['x-correlation-id']),
        this.apiVersion,
      ),
      error: {
        code: this.mapErrorCode(status),
        message,
        retryable: this.isRetryable(status),
        details,
      },
    });
  }

  private extractMessage(
    body: ErrorResponseBody | null,
    exception: unknown,
  ): string {
    if (typeof body === 'string') {
      return body;
    }

    if (Array.isArray(body?.message)) {
      return body.message.join('; ');
    }

    if (body?.message) {
      return body.message;
    }

    if (exception instanceof Error) {
      return exception.message;
    }

    return 'Internal server error.';
  }

  private mapErrorCode(status: number): string {
    switch (status) {
      case HTTP_STATUS.BAD_REQUEST:
        return 'validation_failed';
      case HTTP_STATUS.UNAUTHORIZED:
        return 'unauthorized';
      case HTTP_STATUS.FORBIDDEN:
        return 'forbidden';
      case HTTP_STATUS.NOT_FOUND:
        return 'not_found';
      case HTTP_STATUS.CONFLICT:
        return 'conflict';
      case HTTP_STATUS.TOO_MANY_REQUESTS:
        return 'rate_limited';
      case HTTP_STATUS.REQUEST_TIMEOUT:
        return 'timeout';
      case HTTP_STATUS.BAD_GATEWAY:
      case HTTP_STATUS.SERVICE_UNAVAILABLE:
      case HTTP_STATUS.GATEWAY_TIMEOUT:
        return 'upstream_unavailable';
      default:
        return status >= 500 ? 'internal_error' : 'bad_request';
    }
  }

  private isRetryable(status: number): boolean {
    return (
      status === HTTP_STATUS.TOO_MANY_REQUESTS ||
      status === HTTP_STATUS.REQUEST_TIMEOUT ||
      status === HTTP_STATUS.BAD_GATEWAY ||
      status === HTTP_STATUS.SERVICE_UNAVAILABLE ||
      status === HTTP_STATUS.GATEWAY_TIMEOUT ||
      status >= 500
    );
  }

  private getHeaderValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return value ?? null;
  }
}
