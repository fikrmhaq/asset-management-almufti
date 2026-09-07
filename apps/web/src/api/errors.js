import { t } from '@/i18n';

/**
 * API error normalization — `06-api.md` §1.4, `IMPLEMENTATION_PLAN.md` §15.2.
 *
 * Every failure a screen sees is one shape, whatever went wrong: a 4xx with the
 * documented envelope, a 5xx with none, a network outage, or a request the
 * client aborted. Screens branch on `code`, never on `error.response?.data?...`.
 *
 * The API's `message` is written to be shown to users (REQ-VAL-006), so it is
 * used directly rather than replaced with generic copy (`07-ui.md` §7).
 */

/** The documented codes, plus two the client itself can produce. */
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** No response at all — server down, DNS failure, offline. */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** The request was cancelled by the client, e.g. a superseded query. */
  CANCELLED: 'CANCELLED',
});

/**
 * Fallback copy, used only when the server sent no usable message.
 *
 * Translated at call time, not at module load: these are the only error strings
 * the client owns. The API's own `message` is written to be shown to users
 * (REQ-VAL-006) and is passed through exactly as the server sent it — localizing
 * that text would mean localizing every `throw` in the API.
 */
const FALLBACK_KEY = {
  [ERROR_CODES.UNAUTHORIZED]: 'common.errors.unauthorized',
  [ERROR_CODES.FORBIDDEN]: 'common.errors.forbidden',
  [ERROR_CODES.NOT_FOUND]: 'common.errors.notFound',
  [ERROR_CODES.CONFLICT]: 'common.errors.conflict',
  [ERROR_CODES.VALIDATION_ERROR]: 'common.errors.validation',
  [ERROR_CODES.INTERNAL_ERROR]: 'common.errors.internal',
  [ERROR_CODES.NETWORK_ERROR]: 'common.errors.network',
  [ERROR_CODES.CANCELLED]: 'common.errors.cancelled',
};

const fallbackMessage = (code) => t(FALLBACK_KEY[code] ?? FALLBACK_KEY[ERROR_CODES.INTERNAL_ERROR]);

export class ApiError extends Error {
  /**
   * @param {{code: string, message: string, status: number|null,
   *          details?: {field?: string, issue: string}[], cause?: unknown}} init
   */
  constructor({ code, message, status, details = [], cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** Field name → issue, ready to hand to React Hook Form (§15.6). */
  get fieldErrors() {
    const output = {};
    for (const detail of this.details) {
      if (detail?.field && !output[detail.field]) output[detail.field] = detail.issue;
    }
    return output;
  }

  get isValidation() {
    return this.code === ERROR_CODES.VALIDATION_ERROR;
  }

  /** Whether the session is the problem, so the shell can react (Phase 10). */
  get isAuthFailure() {
    return this.code === ERROR_CODES.UNAUTHORIZED;
  }
}

/** Maps a status to a code, for a response that did not use the envelope. */
function codeForStatus(status) {
  switch (status) {
    case 400:
      return ERROR_CODES.VALIDATION_ERROR;
    case 401:
      return ERROR_CODES.UNAUTHORIZED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 409:
      return ERROR_CODES.CONFLICT;
    default:
      return ERROR_CODES.INTERNAL_ERROR;
  }
}

/**
 * Turns anything Axios can reject with into an `ApiError`.
 *
 * @param {unknown} error
 * @returns {ApiError}
 */
export function normalizeError(error) {
  if (error instanceof ApiError) return error;

  if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') {
    return new ApiError({
      code: ERROR_CODES.CANCELLED,
      message: fallbackMessage(ERROR_CODES.CANCELLED),
      status: null,
      cause: error,
    });
  }

  const response = error?.response;

  if (!response) {
    return new ApiError({
      code: ERROR_CODES.NETWORK_ERROR,
      message: fallbackMessage(ERROR_CODES.NETWORK_ERROR),
      status: null,
      cause: error,
    });
  }

  const envelope = response.data?.error;
  const code = envelope?.code ?? codeForStatus(response.status);

  return new ApiError({
    code,
    // A 500 body never carries anything safe to show (REQ-VAL-006), so the
    // fallback wins there even if the server said something.
    message:
      code === ERROR_CODES.INTERNAL_ERROR
        ? fallbackMessage(ERROR_CODES.INTERNAL_ERROR)
        : (envelope?.message ?? fallbackMessage(code)),
    status: response.status,
    details: Array.isArray(envelope?.details) ? envelope.details : [],
    cause: error,
  });
}
