import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';

import { openDatabase, migrate } from '../src/db/index.js';
import { seedMenuIfEmpty } from '../src/db/seed-data.js';
import { createApp } from '../src/app.js';
import env from '../src/config/env.js';
import site from '../src/config/site.js';
import { buildThemeCss, readableOn } from '../src/utils/theme.js';
import { hashPassword } from '../src/utils/crypto.js';
import { throttleAccount } from '../src/services/auth.service.js';

// Relógio fixo em uma terça-feira às 09:00 (horário de Brasília = 12:00 UTC)
const FIXED_NOW = new Date('2026-10-20T12:00:00.000Z');
const OPEN_WEDNESDAY = '2026-10-21';
const CLOSED_MONDAY = '2026-10-26';

describe('Maison Café · API, Segurança & Banco de Dados', () => {
  let db;
  let app;

  beforeEach(() => {
    db = openDatabase(':memory:');
    migrate(db);
    app = createApp({
      db,
      clock: () => FIXED_NOW,
      enableRateLimit: false,
    });
    seedMenuIfEmpty(db, app.locals.repos);
  });

  afterEach(() => {
    db.close();
  });

  it('responde /api/health e aplica cabeçalhos de segurança (CSP, X-Content-Type-Options)', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.equal(res.body.status, 'ok');
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('renderiza a vitrine pública (/), a política LGPD (/privacidade) e o cardápio (/api/menu)', async () => {
    const home = await request(app).get('/').expect(200);
    assert.match(home.text, /Specialty Coffee/i);
    assert.match(home.text, /application\/ld\+json/);

    const privacy = await request(app).get('/privacidade').expect(200);
    assert.match(privacy.text, /Política de Privacidade/i);

    const menu = await request(app).get('/api/menu').expect(200);
    assert.ok(Array.isArray(menu.body));
    assert.ok(menu.body.length >= 4);
    assert.ok(menu.body[0].items.length >= 1);
  });

  it('bloqueia segundas-feiras e datas passadas e lista horários em dias abertos', async () => {
    const monday = await request(app)
      .get(`/api/availability?date=${CLOSED_MONDAY}`)
      .expect(200);
    assert.equal(monday.body.available, false);

    const past = await request(app).get('/api/availability?date=2026-10-10').expect(200);
    assert.equal(past.body.available, false);

    const wed = await request(app)
      .get(`/api/availability?date=${OPEN_WEDNESDAY}`)
      .expect(200);
    assert.equal(wed.body.available, true);
    assert.ok(wed.body.slots.some((s) => s.time === '10:00' && s.available));
  });

  it('cria reserva válida, impede duplicidade por telefone e respeita o limite de capacidade do horário', async () => {
    // 1. Sem consentimento LGPD -> 422
    await request(app)
      .post('/api/reservations')
      .send({
        name: 'Clara Monteiro',
        phone: '(61) 99111-2233',
        partySize: 4,
        date: OPEN_WEDNESDAY,
        time: '10:00',
        experience: 'degustacao',
        consent: false,
      })
      .expect(422);

    // 2. Reserva válida (6 pessoas de 16 lugares)
    const first = await request(app)
      .post('/api/reservations')
      .send({
        name: 'Clara Monteiro',
        phone: '(61) 99111-2233',
        partySize: 6,
        date: OPEN_WEDNESDAY,
        time: '10:00',
        experience: 'degustacao',
        consent: true,
      })
      .expect(201);

    assert.equal(first.body.reservation.code.length, 8);
    assert.equal(first.body.reservation.status, 'pending');

    // 3. Mesmo WhatsApp na mesma data -> 409 Conflict
    await request(app)
      .post('/api/reservations')
      .send({
        name: 'Clara Monteiro',
        phone: '(61) 99111-2233',
        partySize: 2,
        date: OPEN_WEDNESDAY,
        time: '11:00',
        experience: 'mesa',
        consent: true,
      })
      .expect(409);

    // 4. Segunda reserva no mesmo horário ocupando mais 8 lugares (total = 14/16)
    await request(app)
      .post('/api/reservations')
      .send({
        name: 'Lucas Andrade',
        phone: '(61) 99222-3344',
        partySize: 8,
        date: OPEN_WEDNESDAY,
        time: '10:00',
        experience: 'brunch',
        consent: true,
      })
      .expect(201);

    // 5. Terceira reserva tentando 4 lugares quando só restam 2 -> 409 Conflict
    const overflow = await request(app)
      .post('/api/reservations')
      .send({
        name: 'Fernanda Lima',
        phone: '(61) 99333-4455',
        partySize: 4,
        date: OPEN_WEDNESDAY,
        time: '10:00',
        experience: 'mesa',
        consent: true,
      })
      .expect(409);

    assert.match(overflow.body.error.message, /Restam apenas 2/i);
  });

  it('descarta silenciosamente submissões que preenchem o honeypot anti-bot', async () => {
    const res = await request(app)
      .post('/api/reservations')
      .send({
        name: 'Bot Spammer',
        phone: '(61) 99888-7766',
        partySize: 2,
        date: OPEN_WEDNESDAY,
        time: '14:00',
        experience: 'mesa',
        consent: true,
        website: 'https://spam.example',
      })
      .expect(201);

    assert.equal(res.body.reservation.code.length, 8);
    assert.equal(app.locals.repos.reservations.list({ limit: 10, offset: 0 }).total, 0);
  });

  it('protege o painel com autenticação, bloqueio contra força bruta, CSRF e auditoria imutável', async () => {
    const passwordHash = await hashPassword('SenhaForte@2026');
    app.locals.repos.users.create({
      email: 'owner@croma.cafe',
      name: 'Proprietário',
      passwordHash,
      role: 'owner',
    });

    // Não autenticado -> 401
    await request(app).get('/api/admin/stats').expect(401);

    // 5 tentativas incorretas bloqueiam temporariamente a conta (423 na 6ª)
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/admin/login')
        .send({ email: 'owner@croma.cafe', password: 'errada' })
        .expect(401);
    }
    await request(app)
      .post('/api/admin/login')
      .send({ email: 'owner@croma.cafe', password: 'SenhaForte@2026' })
      .expect(423);

    // Limpa o bloqueio para testar o fluxo autenticado
    app.locals.repos.loginThrottle.clearAccount(throttleAccount('owner@croma.cafe'));

    const agent = request.agent(app);
    const login = await agent
      .post('/api/admin/login')
      .send({ email: 'owner@croma.cafe', password: 'SenhaForte@2026' })
      .expect(200);

    const { csrfToken } = login.body;
    assert.ok(csrfToken.length >= 32);

    // Escrita sem cabeçalho X-CSRF-Token -> 403 Forbidden
    await agent
      .post('/api/admin/menu/categories')
      .send({ name: 'Especiais', slug: 'especiais', position: 5 })
      .expect(403);

    // Com X-CSRF-Token -> 201 Created
    const cat = await agent
      .post('/api/admin/menu/categories')
      .set('X-CSRF-Token', csrfToken)
      .send({ name: 'Grãos em Pacote', slug: 'graos-pacote', position: 5 })
      .expect(201);

    assert.equal(cat.body.data.slug, 'graos-pacote');

    // A tabela audit_log é imutável por trigger no SQLite
    assert.throws(() => {
      db.prepare("UPDATE audit_log SET action = 'adulterado'").run();
    }, /audit_log é imutável/);
  });

  it('anonimiza dados pessoais vencidos conforme prazo de retenção da LGPD', () => {
    const id = app.locals.repos.reservations.create({
      code: 'OLD12345',
      name: 'Cliente Antigo',
      phone: '61991234567',
      email: 'antigo@exemplo.com',
      partySize: 2,
      date: '2025-01-10',
      time: '10:00',
      experience: 'mesa',
      notes: 'Sem lactose',
      privacyVersion: '2026-10-01',
      ipHash: 'abcdef',
    });

    const changed = app.locals.repos.reservations.anonymizeOlderThan('2026-01-01');
    assert.equal(changed, 1);

    const row = app.locals.repos.reservations.findById(id);
    assert.equal(row.customer_name, 'Titular anonimizado');
    assert.equal(row.customer_phone, '0000000000');
    assert.equal(row.customer_email, null);
    assert.equal(row.notes, null);
    assert.equal(row.ip_hash, null);
    assert.ok(row.anonymized_at);
  });
});

describe('Vitrine · modo demonstração, tema e versão estática', () => {
  let db;

  const makeApp = (opts = {}) => {
    db = openDatabase(':memory:');
    migrate(db);
    const app = createApp({ db, enableRateLimit: false, clock: () => FIXED_NOW, ...opts });
    seedMenuIfEmpty(db, app.locals.repos);
    return app;
  };

  afterEach(() => {
    db.close();
  });

  it('por padrão NÃO expõe o painel de demonstração nem o link do /admin ao público', async () => {
    const home = await request(makeApp()).get('/').expect(200);
    assert.doesNotMatch(home.text, /Modo Demonstração Comercial/);
    assert.doesNotMatch(home.text, /id="demo-studio"/);
    assert.doesNotMatch(home.text, /href="\/admin"/);
    assert.doesNotMatch(home.text, /data-demo="true"/);
  });

  it('com DEMO_MODE=true mostra o painel de demonstração e o link do /admin', async () => {
    const home = await request(makeApp({ env: { ...env, DEMO_MODE: true } })).get('/').expect(200);
    assert.match(home.text, /Modo Demonstração Comercial/);
    assert.match(home.text, /href="\/admin"/);
    assert.match(home.text, /data-demo="true"/);
  });

  it('aplica theme.overrides via /css/theme.css (compatível com a CSP, sem style inline)', async () => {
    const themed = { ...site, theme: { preset: 'noir', overrides: { accent: '#1f6f5c', background: '#101820' } } };
    const app = makeApp({ site: themed });

    const css = await request(app).get('/css/theme.css').expect(200);
    assert.match(css.headers['content-type'], /text\/css/);
    assert.match(css.text, /html\[data-theme='noir'\]/);
    assert.match(css.text, /--color-accent: #1f6f5c;/);
    assert.match(css.text, /--color-bg: #101820;/);
    assert.match(css.text, /--color-accent-Contrast: #f9f4ec;/);

    const home = await request(app).get('/').expect(200);
    assert.match(home.text, /href="\/css\/theme\.css"/);
    assert.match(home.text, /<meta name="theme-color" content="#101820">/);
    assert.doesNotMatch(home.text, / style="/);
  });

  it('sem overrides não carrega theme.css; contraste do botão escolhe texto legível', async () => {
    const home = await request(makeApp()).get('/').expect(200);
    assert.doesNotMatch(home.text, /theme\.css/);
    assert.equal(readableOn('#f2c94c'), '#0b0908');
    assert.equal(readableOn('#1f3a5f'), '#f9f4ec');
    assert.match(buildThemeCss({ preset: 'creme', overrides: { accent: '#8a5a2b' } }), /color-mix\(in srgb, #8a5a2b, black 18%\)/);
  });

  it('versão estática: status e horários calculados no navegador e reserva por WhatsApp', async () => {
    const home = await request(makeApp({ staticBuild: true })).get('/').expect(200);
    assert.match(home.text, /data-static="true"/);
    // Sem servidor, o "Aberto agora" não pode vir pronto: o navegador calcula com estes dados
    assert.doesNotMatch(home.text, /Aberto agora|Fechado agora/);
    const storeData = JSON.parse(home.text.match(/<script type="application\/json" id="store-data">(.*?)<\/script>/s)[1]);
    assert.equal(storeData.timezone, 'America/Sao_Paulo');
    assert.deepEqual(storeData.hours.tue, [['08:00', '19:00']]);
    assert.ok(storeData.closedDates.includes('2026-12-25'));
    assert.match(home.text, /Enviar reserva pelo WhatsApp/);
    assert.doesNotMatch(home.text, /id="reservation-lookup"/, 'consulta por código só existe com banco');

    const server = await request(makeApp()).get('/').expect(200);
    assert.match(server.text, /Aberto agora|Fechado agora/);
    assert.match(server.text, /id="reservation-lookup"/);
  });
});

