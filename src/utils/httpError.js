/**
 * Erro HTTP com status e código legível por máquina.
 * Somente a `message` de um HttpError chega ao cliente; erros inesperados
 * recebem uma mensagem genérica (ver middleware/errors.js).
 */
export class HttpError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code ?? defaultCode(status);
    this.details = details;
    this.expose = true;
  }
}

function defaultCode(status) {
  return (
    {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      423: 'LOCKED',
      429: 'TOO_MANY_REQUESTS',
    }[status] ?? 'ERROR'
  );
}

export const badRequest = (msg, opts) => new HttpError(400, msg, opts);
export const unauthorized = (msg = 'Autenticação necessária.', opts) => new HttpError(401, msg, opts);
export const forbidden = (msg = 'Acesso negado.', opts) => new HttpError(403, msg, opts);
export const notFound = (msg = 'Recurso não encontrado.', opts) => new HttpError(404, msg, opts);
export const conflict = (msg, opts) => new HttpError(409, msg, opts);
export const unprocessable = (msg, opts) => new HttpError(422, msg, opts);

