import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodType } from 'zod';
import { logger } from './logger.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Wrap async route handlers so rejected promises reach the error handler (Express 4). */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first.path.length ? `${first.path.join('.')}: ` : '';
    throw new HttpError(400, `${where}${first.message}`);
  }
  return result.data;
}

export const idParam = z.string().min(1).max(64);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  // body-parser errors (malformed JSON, payload too large)
  const status = (err as { status?: number }).status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: status === 413 ? 'Request body too large' : 'Bad request' });
    return;
  }
  logger.error('Unhandled error', { error: err instanceof Error ? err.stack : String(err) });
  res.status(500).json({ error: 'Internal server error' });
}
