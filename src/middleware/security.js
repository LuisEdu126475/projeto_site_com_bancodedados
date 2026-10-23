import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { forbidden } from '../utils/httpError.js';

/**
 * Cabeçalhos de segurança, incluindo uma Content-Security-Policy estrita:
 * nenhum script/estilo inline e nenhum domínio de terceiros. O site só
 * carrega recursos do próprio servidor, o que neutraliza XSS e injeção de
 * scripts por CDNs comprometidas.
 */
export function securityHeaders(env) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        manifestSrc: ["'self'"],
        ...(env.isProduction ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: env.isProduction ? { maxAge: 63072000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
  });
}

/** Política de permissões: desativa APIs do navegador que o site não usa. */
export function permissionsPolicy(_req, res, next) {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  next();
}

/**
 * Proteção CSRF em camada dupla (a outra é o token por sessão no painel):
 * requisições que alteram dados precisam vir da mesma origem do site.
 */
export function sameOriginGuard(allowedOrigins = []) {
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const origin = req.get('origin');
    const site = req.get('sec-fetch-site');
    if (site && !['same-origin', 'none'].includes(site)) return next(forbidden('Origem não permitida.'));
    if (origin) {
      const self = `${req.protocol}://${req.get('host')}`;
      if (origin !== self && !allowedOrigins.includes(origin)) return next(forbidden('Origem não permitida.'));
    }
    next();
  };
}

/**
 * Limitadores de taxa (por IP). Criados por instância da aplicação;
 * `enabled: false` existe apenas para a suíte de testes.
 */
export function createRateLimiters({ enabled = true } = {}) {
  const base = {
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: () => !enabled,
    handler: (_req, res, _next, options) =>
      res.status(options.statusCode).json({
        error: { code: 'TOO_MANY_REQUESTS', message: options.message },
      }),
  };

  return {
    /** Limite geral da API. */
    api: rateLimit({ ...base, windowMs: 60_000, limit: 120, message: 'Muitas requisições. Aguarde um instante.' }),
    /** Criação de reservas: contra spam e esgotamento proposital de vagas. */
    reservations: rateLimit({
      ...base,
      windowMs: 15 * 60_000,
      limit: 8,
      message: 'Você fez muitas tentativas de reserva. Tente novamente em alguns minutos.',
    }),
    /** Consulta e cancelamento de reserva pelo cliente: contra tentativa e erro de códigos. */
    lookup: rateLimit({
      ...base,
      windowMs: 15 * 60_000,
      limit: 20,
      message: 'Muitas consultas seguidas. Tente novamente em alguns minutos.',
    }),
    /** Login: contra força bruta (soma-se ao bloqueio por conta). */
    login: rateLimit({
      ...base,
      windowMs: 15 * 60_000,
      limit: 10,
      skipSuccessfulRequests: true,
      message: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
    }),
  };
}
