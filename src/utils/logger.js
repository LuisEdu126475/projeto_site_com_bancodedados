import pino from 'pino';
import env from '../config/env.js';

/**
 * Logger estruturado (JSON em produção, legível em desenvolvimento).
 * Cabeçalhos sensíveis são removidos para nunca vazar sessões nos logs.
 */
const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.currentPassword',
      '*.newPassword',
    ],
    censor: '[redacted]',
  },
  ...(env.isProduction || env.isTest
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});

export default logger;

