/** Domain error with an HTTP mapping. Free of Next.js imports so services and the worker can use it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new ApiError(400, "invalid_request", message, details);
export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) => new ApiError(409, "conflict", message, details);
export const unprocessable = (message: string, details?: unknown) => new ApiError(422, "unprocessable", message, details);
export const forbidden = (message = "You don't have access to this action.") => new ApiError(403, "forbidden", message);
