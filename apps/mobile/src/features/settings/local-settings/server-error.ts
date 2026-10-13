// Server error shapes shared by the calendar and event-type settings reads.

import type { ServerReadError } from "@/lib/server-read-fallback";

export function asServerReadError(error: unknown): ServerReadError {
  if (error && typeof error === "object") {
    return error as ServerReadError;
  }
  return { message: String(error) };
}

export function serverOperationError(
  operation: string,
  source: ServerReadError,
): Error & ServerReadError {
  const error = new Error(
    `${operation}: ${source.message ?? "неизвестная ошибка сервера"}`,
  ) as Error & ServerReadError;
  error.code = source.code;
  error.details = source.details;
  return error;
}
