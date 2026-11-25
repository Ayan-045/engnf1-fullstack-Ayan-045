import type { Response } from 'express';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string
) {
  return res.status(status).json({
    error: {
      code,
      message,
    },
  });
}

export function handleRouteError(res: Response, err: unknown) {
  if (err instanceof ApiError) {
    return sendApiError(res, err.status, err.code, err.message);
  }
  console.error('Unhandled API error:', err);
  return sendApiError(
    res,
    500,
    'INTERNAL_SERVER_ERROR',
    'An unexpected server error occurred.'
  );
}
