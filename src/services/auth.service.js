import { HttpError, unauthorized, unprocessable } from '../utils/httpError.js';
import { getDummyHash, hashPassword, randomToken, sha256, verifyPassword } from '../utils/crypto.js';

// Camada 1: e-mail + conexão
const MAX_FAILED_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const LOCK_MINUTES = 15;
// Camada 2: a conta inteira, somando todas as conexões (ataque espalhado em vários IPs)
export const ACCOUNT_MAX_FAILURES = 30;
const ACCOUNT_WINDOW_MINUTES = 60;
const ACCOUNT_RESTRICT_MINUTES = 30;

/** Identificadores do bloqueio de login (somente hashes, nunca o e-mail ou IP em claro). */
export const throttleAccount = (email) => sha256(`login:${String(email).trim().toLowerCase()}`);
const throttleKey = (email, ipHash) =>
  sha256(`login:${String(email).trim().toLowerCase()}|${ipHash ?? 'sem-ip'}`);

const isFuture = (iso) => Boolean(iso) && new Date(iso) > new Date();

export function createAuthService({ repos, env }) {
  /**
   * Autentica um administrador.
   *  • Mensagem genérica para e-mail ou senha errados (não revela se o e-mail existe)
   *  • Tempo de resposta equalizado com um hash fictício
   *  • 5 erros em 15 min travam por 15 min só a combinação e-mail + conexão
   *  • 30 erros em 1 h na conta (somando todas as conexões) restringem o login por
   *    30 min a aparelhos que já entraram antes: um ataque espalhado em muitos IPs
   *    é contido e, mesmo assim, o dono continua entrando do aparelho de sempre
   *  • A tentativa é contada ANTES de conferir a senha, então várias requisições
   *    simultâneas não conseguem passar juntas pela verificação de bloqueio
   */
  async function login({ email, password }, { ipHash, userAgent, deviceToken }) {
    const key = throttleKey(email, ipHash);
    const account = throttleAccount(email);

    if (isFuture(repos.loginThrottle.find(key)?.locked_until)) {
      throw new HttpError(
        423,
        'Muitas tentativas incorretas a partir desta conexão. Aguarde 15 minutos para tentar de novo.',
        { code: 'LOCKED' },
      );
    }

    const found = repos.users.findByEmail(email);
    const user = found && found.is_active ? found : null;
    const deviceHash = typeof deviceToken === 'string' && deviceToken.length <= 100 ? sha256(deviceToken) : null;
    const trustedDevice = Boolean(user && deviceHash && repos.devices.isTrusted(deviceHash, user.id));

    if (!trustedDevice && isFuture(repos.accountGuard.find(account)?.restricted_until)) {
      throw new HttpError(
        423,
        'Por segurança, esta conta recebeu muitas tentativas de senha. Por 30 minutos, o login só funciona nos aparelhos que já entraram antes.',
        { code: 'ACCOUNT_RESTRICTED' },
      );
    }

    // Conta antes de conferir (contagem pessimista); desfeita se a senha estiver certa.
    repos.loginThrottle.registerFailure({
      key,
      account,
      maxAttempts: MAX_FAILED_ATTEMPTS,
      windowMinutes: WINDOW_MINUTES,
      lockMinutes: LOCK_MINUTES,
    });
    repos.accountGuard.registerFailure({
      account,
      maxAttempts: ACCOUNT_MAX_FAILURES,
      windowMinutes: ACCOUNT_WINDOW_MINUTES,
      restrictMinutes: ACCOUNT_RESTRICT_MINUTES,
    });

    if (!user) {
      await verifyPassword(password, await getDummyHash());
      throw unauthorized('E-mail ou senha incorretos.', { code: 'INVALID_CREDENTIALS' });
    }

    if (!(await verifyPassword(password, user.password_hash))) {
      repos.audit.log({ userId: user.id, action: 'auth.login_failed', entity: 'admin_user', entityId: user.id, ipHash });
      throw unauthorized('E-mail ou senha incorretos.', { code: 'INVALID_CREDENTIALS' });
    }

    repos.loginThrottle.clear(key);
    repos.accountGuard.undoFailure(account);
    repos.users.registerSuccess(user.id);

    // Aparelho conhecido: renova; aparelho novo: passa a ser conhecido.
    let newDeviceToken = null;
    if (trustedDevice) {
      repos.devices.touch(deviceHash);
    } else {
      newDeviceToken = randomToken(32);
      repos.devices.add(sha256(newDeviceToken), user.id);
    }

    const session = createSession(user.id, { ipHash, userAgent });
    repos.audit.log({ userId: user.id, action: 'auth.login', entity: 'admin_user', entityId: user.id, ipHash });
    return { ...session, deviceToken: newDeviceToken, user: repos.users.findById(user.id) };
  }

  /** Gera um token de sessão novo (rotação a cada login, contra fixação de sessão). */
  function createSession(userId, { ipHash, userAgent }) {
    const token = randomToken(32);
    const csrfToken = randomToken(32);
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
    repos.sessions.create({
      id: sha256(token),
      userId,
      csrfToken,
      ipHash,
      userAgent: userAgent?.slice(0, 300) ?? null,
      expiresAt: expiresAt.toISOString(),
    });
    return { token, csrfToken, expiresAt };
  }

  function resolveSession(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const session = repos.sessions.findValid(sha256(token));
    if (session) repos.sessions.touch(session.id);
    return session ?? null;
  }

  function logout(token) {
    if (token) repos.sessions.delete(sha256(token));
  }

  /** Troca de senha: exige a senha atual e encerra as demais sessões abertas. */
  async function changePassword(userId, { currentPassword, newPassword }, { sessionId, ipHash }) {
    const user = repos.users.findAuthById(userId);
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      throw unprocessable('A senha atual está incorreta.');
    }
    if (currentPassword === newPassword) throw unprocessable('A nova senha deve ser diferente da atual.');
    repos.users.updatePassword(userId, await hashPassword(newPassword));
    repos.sessions.deleteAllForUser(userId, sessionId);
    repos.audit.log({ userId, action: 'auth.password_changed', entity: 'admin_user', entityId: userId, ipHash });
  }

  return { login, logout, resolveSession, changePassword, createSession };
}

