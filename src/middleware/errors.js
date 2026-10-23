import logger from '../utils/logger.js';
import { HttpError } from '../utils/httpError.js';

/** 404 para rotas inexistentes: JSON na API, página elegante no site. */
export function notFoundHandler(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
  }
  res.status(404).render('pages/error', { status: 404, title: 'Página não encontrada' });
}

/**
 * Tratamento central de erros. Erros esperados (HttpError) devolvem sua
 * mensagem; erros inesperados são registrados no log e o cliente recebe uma
 * mensagem genérica, sem stack trace nem detalhes internos.
 */
export function errorHandler(err, req, res, _next) {
  let status = err.status ?? err.statusCode ?? 500;

  // JSON malformado ou corpo grande demais (body-parser)
  if (err.type === 'entity.parse.failed') status = 400;
  if (err.type === 'entity.too.large') status = 413;

  // 503 é proposital (ex.: "servidor ocupado" na fila de senhas, reservas
  // desativadas): a mensagem explica o que fazer, então chega ao usuário.
  const intentional503 = status === 503 && err instanceof HttpError;
  const expose = err.expose && (status < 500 || intentional503);
  if (intentional503) logger.warn({ url: req.originalUrl, code: err.code }, err.message);
  else if (status >= 500) logger.error({ err, url: req.originalUrl, method: req.method }, 'Erro não tratado');

  const message = expose
    ? err.message
    : status === 413
      ? 'Conteúdo grande demais.'
      : status === 400
        ? 'Requisição inválida.'
        : 'Ocorreu um erro inesperado. Tente novamente em instantes.';

  if (res.headersSent) return;

  if (req.path.startsWith('/api/')) {
    return res.status(status).json({
      error: { code: err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR'), message, ...(expose && err.details ? { details: err.details } : {}) },
    });
  }
  res.status(status).render('pages/error', {
    status,
    title: status === 404 ? 'Página não encontrada' : 'Algo saiu do ponto',
  });
}

