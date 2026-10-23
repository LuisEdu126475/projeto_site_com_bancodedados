import { forbidden, unauthorized } from '../utils/httpError.js';
import { safeEqual } from '../utils/crypto.js';

export const sessionCookieName = (env) => (env.isProduction ? '__Host-sid' : 'sid');

export function sessionCookieOptions(env, expires) {
  return {
    httpOnly: true, // inacessível via JavaScript (proteção contra XSS)
    secure: env.isProduction, // somente HTTPS em produção
    sameSite: 'strict', // não é enviado em navegações vindas de outros sites
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

/**
 * "Aparelho conhecido": token aleatório guardado (só como hash) quando a pessoa
 * faz login. Se a conta sofrer um ataque de senhas, esses aparelhos continuam
 * conseguindo entrar. Não dá acesso sozinho: a senha continua obrigatória.
 */
export const deviceCookieName = (env) => (env.isProduction ? '__Host-device' : 'device');
export const DEVICE_COOKIE_DAYS = 180;
export const deviceCookieOptions = (env) =>
  sessionCookieOptions(env, new Date(Date.now() + DEVICE_COOKIE_DAYS * 86_400_000));

/** Anexa a sessão (se houver) em req.session. */
export function loadSession({ auth, env }) {
  const name = sessionCookieName(env);
  return (req, _res, next) => {
    req.session = auth.resolveSession(req.cookies?.[name]);
    next();
  };
}

/** Exige administrador autenticado e, em métodos de escrita, um token CSRF válido. */
export function requireAdmin(req, _res, next) {
  if (!req.session) return next(unauthorized());
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const token = req.get('x-csrf-token');
    if (!token || !safeEqual(token, req.session.csrf_token)) {
      return next(forbidden('Token de segurança inválido. Recarregue a página.', { code: 'CSRF' }));
    }
  }
  next();
}

export function requireOwner(req, _res, next) {
  if (req.session?.role !== 'owner') return next(forbidden('Apenas o proprietário pode fazer isso.'));
  next();
}

