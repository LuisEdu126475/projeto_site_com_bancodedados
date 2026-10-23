import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';

import { openDatabase, migrate } from '../src/db/index.js';
import { seedMenuIfEmpty } from '../src/db/seed-data.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/utils/crypto.js';

// Terça-feira, 20/10/2026, 09:00 em Brasília
const FIXED_NOW = new Date('2026-10-20T12:00:00.000Z');
const WEDNESDAY = '2026-10-21';
const NEXT_WEDNESDAY = '2026-11-04';

describe('Versão com banco · datas fechadas, consulta/cancelamento e painel ao vivo', () => {
  let db;
  let app;
  let admin;
  let csrf;

  beforeEach(async () => {
    db = openDatabase(':memory:');
    migrate(db);
    app = createApp({ db, clock: () => FIXED_NOW, enableRateLimit: false });
    seedMenuIfEmpty(db, app.locals.repos);
    app.locals.repos.users.create({
      email: 'gerente@croma.cafe',
      name: 'Gerente',
      passwordHash: await hashPassword('SenhaForte@2026'),
      role: 'manager',
    });
    admin = request.agent(app);
    const login = await admin
      .post('/api/admin/login')
      .send({ email: 'gerente@croma.cafe', password: 'SenhaForte@2026' })
      .expect(200);
    csrf = login.body.csrfToken;
  });

  afterEach(() => db.close());

  const reserve = (overrides = {}) =>
    request(app)
      .post('/api/reservations')
      .send({
        name: 'Clara Monteiro',
        phone: '(61) 99111-2233',
        partySize: 2,
        date: WEDNESDAY,
        time: '10:00',
        experience: 'mesa',
        consent: true,
        ...overrides,
      });

  describe('datas fechadas pelo painel', () => {
    it('bloquear um dia tira os horários do site; liberar devolve', async () => {
      const before = await request(app).get(`/api/availability?date=${NEXT_WEDNESDAY}`).expect(200);
      assert.equal(before.body.available, true);

      const created = await admin
        .post('/api/admin/closed-dates')
        .set('X-CSRF-Token', csrf)
        .send({ date: NEXT_WEDNESDAY, reason: 'Evento fechado' })
        .expect(201);
      assert.equal(created.body.activeReservations, 0);

      const blocked = await request(app).get(`/api/availability?date=${NEXT_WEDNESDAY}`).expect(200);
      assert.equal(blocked.body.available, false);
      assert.match(blocked.body.reason, /Não abriremos/);
      assert.doesNotMatch(JSON.stringify(blocked.body), /Evento fechado/, 'o motivo é interno');

      await reserve({ date: NEXT_WEDNESDAY }).expect(422);

      const list = await admin.get('/api/admin/closed-dates').expect(200);
      const painel = list.body.data.find((d) => d.date === NEXT_WEDNESDAY);
      assert.deepEqual(painel, { date: NEXT_WEDNESDAY, reason: 'Evento fechado', source: 'painel' });
      assert.ok(list.body.data.some((d) => d.date === '2026-12-25' && d.source === 'config'));

      await admin.delete(`/api/admin/closed-dates/${NEXT_WEDNESDAY}`).set('X-CSRF-Token', csrf).expect(204);
      const reopened = await request(app).get(`/api/availability?date=${NEXT_WEDNESDAY}`).expect(200);
      assert.equal(reopened.body.available, true);

      const actions = app.locals.repos.audit.recent(10).map((a) => a.action);
      assert.ok(actions.includes('closed_date.created') && actions.includes('closed_date.deleted'));
    });

    it('avisa quantas reservas já existem no dia bloqueado e valida as entradas', async () => {
      await reserve().expect(201);
      const res = await admin
        .post('/api/admin/closed-dates')
        .set('X-CSRF-Token', csrf)
        .send({ date: WEDNESDAY })
        .expect(201);
      assert.equal(res.body.activeReservations, 1);

      await admin.post('/api/admin/closed-dates').set('X-CSRF-Token', csrf).send({ date: WEDNESDAY }).expect(409);
      await admin.post('/api/admin/closed-dates').set('X-CSRF-Token', csrf).send({ date: '2026-10-01' }).expect(422);
      await admin.post('/api/admin/closed-dates').set('X-CSRF-Token', csrf).send({ date: '2026-02-31' }).expect(422);
      await admin.post('/api/admin/closed-dates').send({ date: NEXT_WEDNESDAY }).expect(403); // sem CSRF
      await request(app).post('/api/admin/closed-dates').send({ date: NEXT_WEDNESDAY }).expect(401);
      await admin.delete('/api/admin/closed-dates/2026-12-25').set('X-CSRF-Token', csrf).expect(409);
    });
  });

  describe('consulta e cancelamento pelo cliente', () => {
    it('acha a reserva só com código + WhatsApp e não expõe dados pessoais', async () => {
      const { body } = await reserve({ email: 'clara@exemplo.com', notes: 'Mesa na janela' }).expect(201);
      const code = body.reservation.code;

      const wrong = await request(app)
        .post('/api/reservations/lookup')
        .send({ code, phone: '(61) 98888-0000' })
        .expect(404);
      const unknown = await request(app)
        .post('/api/reservations/lookup')
        .send({ code: 'ABCDEFGH', phone: '(61) 99111-2233' })
        .expect(404);
      assert.equal(wrong.body.error.message, unknown.body.error.message, 'mesma resposta, sem pistas');

      const found = await request(app)
        .post('/api/reservations/lookup')
        .send({ code: `#${code.toLowerCase()}`, phone: '+55 61 99111-2233' })
        .expect(200);
      assert.equal(found.body.reservation.code, code);
      assert.equal(found.body.reservation.status, 'pending');
      assert.equal(found.body.reservation.canCancel, true);
      assert.doesNotMatch(JSON.stringify(found.body), /99111|clara@|janela/);

      await request(app).post('/api/reservations/lookup').send({ code: 'O0I1', phone: '61991112233' }).expect(422);
    });

    it('cancelar libera a vaga, fica registrado na auditoria e é idempotente', async () => {
      const { body } = await reserve({ partySize: 8 }).expect(201);
      const code = body.reservation.code;
      const slot = async () =>
        (await request(app).get(`/api/availability?date=${WEDNESDAY}`)).body.slots.find((s) => s.time === '10:00');
      assert.equal((await slot()).remaining, 8);

      const cancelled = await request(app)
        .post('/api/reservations/cancel')
        .send({ code, phone: '61991112233' })
        .expect(200);
      assert.equal(cancelled.body.reservation.status, 'cancelled');
      assert.equal((await slot()).remaining, 16);

      await request(app).post('/api/reservations/cancel').send({ code, phone: '61991112233' }).expect(200);
      const audit = app.locals.repos.audit.recent(5).filter((a) => a.action === 'reservation.cancelled_by_customer');
      assert.equal(audit.length, 1);
      assert.equal(audit[0].user_name, null);
    });

    it('não cancela reserva que já passou ou em que o cliente já está na mesa', async () => {
      const { repos } = app.locals;
      const pastId = repos.reservations.create({
        code: 'PASTAAAA',
        name: 'Cliente Antigo',
        phone: '61991234567',
        partySize: 2,
        date: '2026-10-19',
        time: '10:00',
        experience: 'mesa',
        privacyVersion: '2026-10-01',
      });
      assert.ok(pastId);
      const lookup = await request(app)
        .post('/api/reservations/lookup')
        .send({ code: 'PASTAAAA', phone: '61991234567' })
        .expect(200);
      assert.equal(lookup.body.reservation.canCancel, false);
      await request(app).post('/api/reservations/cancel').send({ code: 'PASTAAAA', phone: '61991234567' }).expect(422);

      const { body } = await reserve({ phone: '61990001111' }).expect(201);
      const id = repos.reservations.findByCode(body.reservation.code).id;
      repos.reservations.update(id, { status: 'confirmed' });
      repos.reservations.update(id, { status: 'seated' });
      await request(app)
        .post('/api/reservations/cancel')
        .send({ code: body.reservation.code, phone: '61990001111' })
        .expect(422);
    });

    it('mesmo horário de hoje: cancela até a hora marcada, depois não', async () => {
      // 09:00 em Brasília: reserva de hoje às 11:00 ainda pode ser cancelada
      const { repos } = app.locals;
      repos.reservations.create({
        code: 'TDAYAAAA',
        name: 'Cliente Hoje',
        phone: '61991230000',
        partySize: 2,
        date: '2026-10-20',
        time: '11:00',
        experience: 'mesa',
        privacyVersion: '2026-10-01',
      });
      repos.reservations.create({
        code: 'TDAYBBBB',
        name: 'Cliente Cedo',
        phone: '61991230001',
        partySize: 2,
        date: '2026-10-20',
        time: '08:30',
        experience: 'mesa',
        privacyVersion: '2026-10-01',
      });
      const later = await request(app).post('/api/reservations/lookup').send({ code: 'TDAYAAAA', phone: '61991230000' });
      const earlier = await request(app).post('/api/reservations/lookup').send({ code: 'TDAYBBBB', phone: '61991230001' });
      assert.equal(later.body.reservation.canCancel, true);
      assert.equal(earlier.body.reservation.canCancel, false);
    });
  });

  it('painel percebe reserva nova e mudança de status sem recarregar (latestId / changeToken)', async () => {
    const s0 = (await admin.get('/api/admin/stats').expect(200)).body;
    await reserve().expect(201);
    const s1 = (await admin.get('/api/admin/stats').expect(200)).body;
    assert.ok(s1.latestId > s0.latestId);
    assert.notEqual(s1.changeToken, s0.changeToken);

    const id = s1.latestId;
    await new Promise((r) => setTimeout(r, 5)); // garante updated_at diferente
    await admin.patch(`/api/admin/reservations/${id}`).set('X-CSRF-Token', csrf).send({ status: 'confirmed' }).expect(200);
    const s2 = (await admin.get('/api/admin/stats').expect(200)).body;
    assert.equal(s2.latestId, s1.latestId);
    assert.notEqual(s2.changeToken, s1.changeToken);
  });

  it('a página do painel traz a aba de datas fechadas e o aviso de atualização automática', async () => {
    const page = await request(app).get('/admin').expect(200);
    assert.match(page.text, /data-admin-tab="closures"/);
    assert.match(page.text, /id="live-indicator"/);
    assert.match(page.text, /id="sound-toggle-btn"/);
  });
});
