import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  correlationId: string;
  errors?: Array<{ field: string; message: string }>;
}

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly type: string;
  public readonly errors?: Array<{ field: string; message: string }>;
  public readonly retryAfterSeconds?: number;

  constructor(params: {
    status: number;
    code: string;
    title: string;
    detail: string;
    type?: string;
    errors?: Array<{ field: string; message: string }>;
    retryAfterSeconds?: number;
  }) {
    super(params.detail);
    this.name = new.target.name;
    this.status = params.status;
    this.code = params.code;
    this.title = params.title;
    this.detail = params.detail;
    this.type = params.type ?? `https://codepilot.ai/errors/${params.code.toLowerCase()}`;
    this.errors = params.errors;
    this.retryAfterSeconds = params.retryAfterSeconds;
  }
}

export class ValidationError extends AppError {
  constructor(detail: string, errors?: Array<{ field: string; message: string }>) {
    super({
      status: 400,
      code: 'VALIDATION_ERROR',
      title: 'Validation Failed',
      detail,
      errors,
    });
  }
}

export class UnauthorizedError extends AppError {
  constructor(detail = 'Authentication is required', code = 'UNAUTHORIZED') {
    super({
      status: 401,
      code,
      title: 'Unauthorized',
      detail,
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    super({
      status: 403,
      code,
      title: 'Forbidden',
      detail,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(detail = 'The requested resource was not found', code = 'NOT_FOUND') {
    super({
      status: 404,
      code,
      title: 'Not Found',
      detail,
    });
  }
}

export class ConflictError extends AppError {
  constructor(detail: string, code = 'CONFLICT') {
    super({
      status: 409,
      code,
      title: 'Conflict',
      detail,
    });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(detail = 'Request payload exceeds the maximum allowed size') {
    super({
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      title: 'Payload Too Large',
      detail,
    });
  }
}

export class RateLimitError extends AppError {
  constructor(detail: string, retryAfterSeconds: number) {
    super({
      status: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      title: 'Too Many Requests',
      detail,
      retryAfterSeconds,
    });
  }
}

export function fromZodError(error: ZodError): ValidationError {
  const fieldErrors = error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
  }));
  return new ValidationError('Request validation failed', fieldErrors);
}

export function buildProblemResponse(
  error: unknown,
  instance: string,
  correlationId: string,
  extraHeaders?: Record<string, string>,
): NextResponse<ProblemDetails> {
  const appError =
    error instanceof AppError
      ? error
      : error instanceof ZodError
        ? fromZodError(error)
        : new AppError({
            status: 500,
            code: 'INTERNAL_SERVER_ERROR',
            title: 'Internal Server Error',
            detail: 'An unexpected internal error occurred.',
          });

  const payload: ProblemDetails = {
    type: appError.type,
    title: appError.title,
    status: appError.status,
    detail: appError.detail,
    instance,
    code: appError.code,
    correlationId,
    ...(appError.errors ? { errors: appError.errors } : {}),
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/problem+json; charset=utf-8',
    'X-Request-Id': correlationId,
    'Cache-Control': 'no-store',
    ...extraHeaders,
  };

  if (appError.retryAfterSeconds !== undefined) {
    headers['Retry-After'] = String(appError.retryAfterSeconds);
  }

  return NextResponse.json(payload, { status: appError.status, headers });
}
