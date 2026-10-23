import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

process.env.NODE_ENV = 'test';

import { openDatabase, migrate } from '../src/db/index.js';
import { createRepositories } from '../src/db/repositories.js';
import { seedMenuIfEmpty } from '../src/db/seed-data.js';
import { createApp, canonicalHttpsOrigin } from '../src/app.js';
import env from '../src/config/env.js';
import site from '../src/config/site.js';
import { DEMO_ADMIN_PASSWORD } from '../src/config/demo.js';
import { throttleAccount } from '../src/services/auth.service.js';
import { HASH_CONCURRENCY, HASH_QUEUE_LIMIT, hashPassword, hashQueueStats, verifyPassword } from '../src/utils/crypto.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXED_NOW = new Date('2026-10-20T12:00:00.000Z');
const tmpDb = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-test-')), `${name}.db`);

/** Executa um script do projeto e devolve { code, out }. */
function runNode(args, extraEnv, { timeoutMs = 20_000, until } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const onData = (chunk) => {
      out += chunk;
      if (until && until.test(out)) child.kill('SIGTERM');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

describe('Segurança · correções da auditoria', () => {
  let db;
  let app;
  const makeApp = (opts = {}) => {
    db = openDatabase(':memory:');
    migrate(db);
    app = createApp({ db, clock: () => FIXED_NOW, enableRateLimit: false, ...opts });
    seedMenuIfEmpty(db, app.locals.repos);
    return app;
  };

  afterEach(() => {
    db?.close();
    db = null;
  });

  it('audit_log não pode ser apagado nem editado (triggers no SQLite)', () => {
    makeApp();
    app.locals.repos.audit.log({ action: 'teste.registro', entity: 'teste' });
    assert.throws(() => db.prepare('DELETE FROM audit_log').run(), /audit_log é imutável/);
    assert.throws(() => db.prepare("UPDATE audit_log SET action = 'x'").run(), /audit_log é imutável/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n, 1);
  });

  describe('bloqueio de login por e-mail + conexão', () => {
    beforeEach(async () => {
      makeApp({ env: { ...env, TRUST_PROXY: 1 } });
      app.locals.repos.users.create({
        email: 'dono@croma.cafe',
        name: 'Dono',
        passwordHash: await hashPassword('SenhaForte@2026'),
        role: 'owner',
      });
    });

    const login = (ip, password, email = 'dono@croma.cafe') =>
      request(app).post('/api/admin/login').set('X-Forwarded-For', ip).send({ email, password });

    it('quem erra 5 vezes trava só a própria conexão; o dono entra de outro lugar', async () => {
      for (let i = 0; i < 5; i++) await login('203.0.113.10', 'errada').expect(401);
      await login('203.0.113.10', 'SenhaForte@2026').expect(423);
      await login('198.51.100.7', 'SenhaForte@2026').expect(200);
    });

    it('e-mail inexistente também trava (não revela quais contas existem)', async () => {
      for (let i = 0; i < 5; i++) await login('203.0.113.20', 'errada', 'nao.existe@croma.cafe').expect(401);
      const res = await login('203.0.113.20', 'qualquer', 'nao.existe@croma.cafe').expect(423);
      assert.equal(res.body.error.code, 'LOCKED');
    });

    it('o bloqueio expira e o contador recomeça do zero', async () => {
      for (let i = 0; i < 5; i++) await login('203.0.113.30', 'errada').expect(401);
      await login('203.0.113.30', 'SenhaForte@2026').expect(423);
      const past = new Date(Date.now() - 20 * 60_000).toISOString();
      db.prepare('UPDATE login_throttle SET locked_until = ?, last_failure_at = ?').run(past, past);
      await login('203.0.113.30', 'errada').expect(401);
      await login('203.0.113.30', 'SenhaForte@2026').expect(200);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM login_throttle').get().n, 0);
    });

    it('ataque espalhado em vários IPs: a conta fica restrita, mas o aparelho do dono continua entrando', async () => {
      // O dono já entrou antes deste aparelho: ele vira "conhecido" (cookie de aparelho)
      const owner = request.agent(app);
      const first = await owner
        .post('/api/admin/login')
        .set('X-Forwarded-For', '198.51.100.1')
        .send({ email: 'dono@croma.cafe', password: 'SenhaForte@2026' })
        .expect(200);
      assert.match(first.headers['set-cookie'].join(';'), /device=/);

      // 6 IPs × 5 tentativas = 30 erros na conta (nenhum IP passa de 5)
      for (let ip = 1; ip <= 6; ip++) {
        for (let i = 0; i < 5; i++) await login(`203.0.113.${100 + ip}`, 'errada').expect(401);
      }
      const blocked = await login('192.0.2.50', 'SenhaForte@2026').expect(423);
      assert.equal(blocked.body.error.code, 'ACCOUNT_RESTRICTED', 'aparelho novo espera, mesmo com a senha certa');

      // O aparelho conhecido entra, inclusive de outra rede
      const again = await owner
        .post('/api/admin/login')
        .set('X-Forwarded-For', '192.0.2.77')
        .send({ email: 'dono@croma.cafe', password: 'SenhaForte@2026' })
        .expect(200);
      assert.equal(again.headers['set-cookie'].join(';').includes('device='), false, 'aparelho já conhecido: não troca o cookie');
    });

    it('tentativas simultâneas não furam o bloqueio da conexão', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, () => login('203.0.113.60', 'errada')));
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((s) => s === 401).length, 5, statuses.join(','));
      assert.equal(statuses.filter((s) => s === 423).length, 15);
    });

    it('tabela de bloqueio guarda só hashes (nada de e-mail ou IP em claro)', async () => {
      await login('203.0.113.40', 'errada').expect(401);
      const row = db.prepare('SELECT * FROM login_throttle').get();
      assert.match(row.key, /^[0-9a-f]{64}$/);
      assert.match(row.account, /^[0-9a-f]{64}$/);
      assert.doesNotMatch(JSON.stringify(row), /croma|203\.0\.113/);
    });
  });

  it('erros 503 propositais explicam o motivo (não viram "erro inesperado")', async () => {
    const off = { ...site, reservations: { ...site.reservations, enabled: false } };
    makeApp({ site: off });
    const res = await request(app)
      .post('/api/reservations')
      .send({ name: 'Ana', phone: '61991234567', partySize: 2, date: '2026-10-21', time: '10:00', experience: 'mesa', consent: true })
      .expect(503);
    assert.match(res.body.error.message, /reservas online estão temporariamente desativadas/);
    assert.equal(res.body.error.code, 'DISABLED');
  });

  it('FORCE_HTTPS redireciona sempre para o domínio configurado, ignorando o Host enviado', async () => {
    makeApp({
      env: { ...env, FORCE_HTTPS: true },
      site: { ...site, seo: { ...site.seo, url: 'https://www.cafe-exemplo.com.br' } },
    });
    const res = await request(app).get('/privacidade?x=1').set('Host', 'site-falso.example').expect(308);
    assert.equal(res.headers.location, 'https://www.cafe-exemplo.com.br/privacidade?x=1');
    await request(app).get('/').set('X-Forwarded-Proto', 'https').expect(200);
  });

  it('FORCE_HTTPS sem domínio público é recusado na inicialização', () => {
    assert.throws(() => canonicalHttpsOrigin('http://localhost:3000'), /PUBLIC_URL/);
    assert.equal(canonicalHttpsOrigin('http://www.cafe.com.br/x'), 'https://www.cafe.com.br');
  });

  it('scrypt roda no máximo 2 por vez e recusa com 503 quando a fila lota', async () => {
    let peak = 0;
    const total = HASH_CONCURRENCY + HASH_QUEUE_LIMIT + 6;
    const jobs = Array.from({ length: total }, () => hashPassword('SenhaQualquer@123'));
    const sampler = setInterval(() => (peak = Math.max(peak, hashQueueStats().active)), 1);
    const results = await Promise.allSettled(jobs);
    clearInterval(sampler);
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.ok(peak <= HASH_CONCURRENCY, `pico de ${peak} cálculos simultâneos`);
    assert.equal(rejected.length, 6);
    assert.equal(rejected[0].reason.status, 503);
    assert.deepEqual(hashQueueStats(), { active: 0, waiting: 0 });
  });

  it('cardápio: categoria excluída no painel não volta quando o servidor reinicia', () => {
    makeApp();
    const { repos } = app.locals;
    const cat = repos.menu.listCategories().find((c) => c.slug === 'patisserie-fina');
    db.prepare('DELETE FROM menu_items WHERE category_id = ?').run(cat.id);
    repos.menu.deleteCategory(cat.id);
    const again = seedMenuIfEmpty(db, repos);
    assert.equal(again.seeded, false);
    assert.equal(repos.menu.listCategories().some((c) => c.slug === 'patisserie-fina'), false);
  });

  it('redefinir senha pelo terminal encerra as sessões abertas e registra auditoria', async () => {
    const file = tmpDb('admin');
    const fileDb = openDatabase(file);
    migrate(fileDb);
    const repos = createRepositories(fileDb);
    const userId = repos.users.create({
      email: 'gerente@croma.cafe',
      name: 'Gerente',
      passwordHash: await hashPassword('SenhaAntiga@2026'),
      role: 'manager',
    });
    repos.sessions.create({
      id: 'a'.repeat(64),
      userId,
      csrfToken: 'b'.repeat(43),
      ipHash: null,
      userAgent: null,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    repos.devices.add('c'.repeat(64), userId);
    repos.accountGuard.registerFailure({ account: throttleAccount('gerente@croma.cafe'), maxAttempts: 1, windowMinutes: 60, restrictMinutes: 30 });
    fileDb.close();

    const { code, out } = await runNode(
      ['scripts/create-admin.js', '--email=gerente@croma.cafe', '--password=SenhaNova@20261'],
      { NODE_ENV: 'test', DATABASE_PATH: file },
    );
    assert.equal(code, 0, out);
    assert.match(out, /1 sessão\(ões\) encerrada/);

    const check = openDatabase(file);
    const after = createRepositories(check);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM trusted_devices').get().n, 0, 'aparelhos deixam de ser conhecidos');
    assert.equal(check.prepare('SELECT COUNT(*) AS n FROM login_account_guard').get().n, 0, 'restrição da conta limpa');
    assert.ok(await verifyPassword('SenhaNova@20261', after.users.findByEmail('gerente@croma.cafe').password_hash));
    assert.ok(after.audit.recent(5).some((a) => a.action === 'auth.password_reset_cli'));
    check.close();
  });

  it('em produção o servidor não sobe com a senha pública de demonstração', async () => {
    const file = tmpDb('prod');
    const fileDb = openDatabase(file);
    migrate(fileDb);
    const repos = createRepositories(fileDb);
    repos.users.create({
      email: 'admin@croma.cafe',
      name: 'Demo',
      passwordHash: await hashPassword(DEMO_ADMIN_PASSWORD),
      role: 'owner',
    });
    fileDb.close();

    const prodEnv = {
      NODE_ENV: 'production',
      DATABASE_PATH: file,
      IP_HASH_SECRET: 'x'.repeat(40),
      PORT: '4719',
      HOST: '127.0.0.1',
      PUBLIC_URL: 'https://www.cafe-exemplo.com.br',
      LOG_LEVEL: 'info',
    };
    const refused = await runNode(['src/server.js'], prodEnv);
    assert.equal(refused.code, 1, refused.out);
    assert.match(refused.out, /senha de DEMONSTRAÇÃO/);

    // Com senha própria, o mesmo banco sobe normalmente em produção.
    const ok = openDatabase(file);
    createRepositories(ok).users.updatePassword(1, await hashPassword('SenhaDaCasa@2026'));
    ok.close();
    const started = await runNode(['src/server.js'], prodEnv, { until: /Servidor iniciado/ });
    assert.match(started.out, /Servidor iniciado/);
  });
});
