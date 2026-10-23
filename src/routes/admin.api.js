import { Router } from 'express';
import {
  deviceCookieName,
  deviceCookieOptions,
  requireAdmin,
  requireOwner,
  sessionCookieName,
  sessionCookieOptions,
} from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  categoryInput,
  changePasswordInput,
  closedDateInput,
  closedDateParam,
  idParam,
  loginInput,
  menuItemInput,
  reservationListQuery,
  reservationUpdate,
} from '../schemas.js';
import { toAdminReservation } from '../services/reservation.service.js';
import { hashIp } from '../utils/crypto.js';
import { conflict, notFound, unprocessable } from '../utils/httpError.js';
import { addDays, diffDays, isValidIsoDate, nowInZone } from '../utils/time.js';
import { serializeMenu } from './menu.serializer.js';

export function adminApiRouter({ env, site, repos, services, limiters, clock = () => new Date() }) {
  const router = Router();
  const cookieName = sessionCookieName(env);

  // Respostas do painel nunca devem ser armazenadas em cache.
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const ctx = (req) => ({ userId: req.session?.user_id, ipHash: hashIp(req.ip), sessionId: req.session?.id });
  const publicUser = (s) => ({ id: s.user_id ?? s.id, email: s.email, name: s.name, role: s.role });

  // ---------------------------------------------------------------------------
  //  Autenticação
  // ---------------------------------------------------------------------------
  router.post('/login', limiters.login, validate({ body: loginInput }), async (req, res) => {
    // Encerra uma sessão anterior no mesmo navegador (rotação de sessão)
    services.auth.logout(req.cookies?.[cookieName]);

    const { token, csrfToken, expiresAt, user, deviceToken } = await services.auth.login(req.valid.body, {
      ipHash: hashIp(req.ip),
      userAgent: req.get('user-agent'),
      deviceToken: req.cookies?.[deviceCookieName(env)],
    });
    res.cookie(cookieName, token, sessionCookieOptions(env, expiresAt));
    if (deviceToken) res.cookie(deviceCookieName(env), deviceToken, deviceCookieOptions(env));
    res.json({ user: publicUser(user), csrfToken });
  });

  router.post('/logout', requireAdmin, (req, res) => {
    services.auth.logout(req.cookies?.[cookieName]);
    repos.audit.log({ ...ctx(req), action: 'auth.logout', entity: 'admin_user', entityId: req.session.user_id });
    res.clearCookie(cookieName, sessionCookieOptions(env));
    res.status(204).end();
  });

  router.get('/me', requireAdmin, (req, res) => {
    res.json({ user: publicUser(req.session), csrfToken: req.session.csrf_token, site: siteSummary(site) });
  });

  router.post('/account/password', requireAdmin, validate({ body: changePasswordInput }), async (req, res) => {
    await services.auth.changePassword(req.session.user_id, req.valid.body, ctx(req));
    res.status(204).end();
  });

  // ---------------------------------------------------------------------------
  //  Reservas
  // ---------------------------------------------------------------------------
  router.get('/stats', requireAdmin, (_req, res) => {
    const today = nowInZone(site.timezone, clock()).date;
    const s = repos.reservations.stats(today, addDays(today, 6));
    res.json({
      today,
      todayCount: s.today_count,
      todayGuests: s.today_guests,
      pendingCount: s.pending_count,
      weekCount: s.week_count,
      weekGuests: s.week_guests,
      capacityPerSlot: site.reservations.capacityPerSlot,
      // Usados pelo painel para perceber, sem recarregar a página, que chegou
      // reserva nova (latestId) ou que alguma mudou (changeToken).
      latestId: s.latest_id,
      changeToken: `${s.total_count}:${s.latest_update}`,
    });
  });

  router.get('/reservations', requireAdmin, validate({ query: reservationListQuery }), (req, res) => {
    const { page, pageSize, ...filters } = req.valid.query;
    const { total, rows } = repos.reservations.list({ ...filters, limit: pageSize, offset: (page - 1) * pageSize });
    res.json({
      data: rows.map(toAdminReservation),
      pagination: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) },
    });
  });

  router.get('/reservations/export.csv', requireAdmin, validate({ query: reservationListQuery }), (req, res) => {
    const { page: _p, pageSize: _ps, ...filters } = req.valid.query;
    const { rows } = repos.reservations.list({ ...filters, limit: 10_000, offset: 0 });
    const header = ['Código', 'Data', 'Horário', 'Nome', 'WhatsApp', 'E-mail', 'Pessoas', 'Experiência', 'Status', 'Observações'];
    const lines = rows.map((r) =>
      [r.code, r.reservation_date, r.reservation_time, r.customer_name, r.customer_phone, r.customer_email, r.party_size, r.experience, r.status, r.notes]
        .map(csvCell)
        .join(';'),
    );
    repos.audit.log({ ...ctx(req), action: 'reservation.export', entity: 'reservation', details: { count: rows.length } });
    res
      .set('Content-Type', 'text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="reservas-${nowInZone(site.timezone, clock()).date}.csv"`)
      .send('\uFEFF' + [header.join(';'), ...lines].join('\r\n'));
  });

  router.patch(
    '/reservations/:id',
    requireAdmin,
    validate({ params: idParam, body: reservationUpdate }),
    (req, res) => {
      const updated = services.reservations.updateStatus(req.valid.params.id, req.valid.body, ctx(req));
      res.json({ data: toAdminReservation(updated) });
    },
  );

  // ---------------------------------------------------------------------------
  //  Datas sem reservas (feriados, eventos fechados, reformas)
  // ---------------------------------------------------------------------------
  router.get('/closed-dates', requireAdmin, (_req, res) => {
    res.json({ data: services.availability.closedDates() });
  });

  router.post('/closed-dates', requireAdmin, validate({ body: closedDateInput }), (req, res) => {
    const { date, reason } = req.valid.body;
    const today = nowInZone(site.timezone, clock()).date;
    if (!isValidIsoDate(date)) throw unprocessable('Data inválida.');
    if (diffDays(today, date) < 0) throw unprocessable('Escolha hoje ou uma data futura.');
    if (site.reservations.closedDates.includes(date) || repos.closedDates.has(date)) {
      throw conflict('Esta data já está bloqueada.');
    }
    repos.closedDates.add({ date, reason, userId: req.session.user_id });
    repos.audit.log({ ...ctx(req), action: 'closed_date.created', entity: 'closed_date', entityId: date, details: { reason: reason ?? null } });
    // Reservas que já existiam nesse dia continuam valendo: a equipe decide
    // se cancela e avisa cada cliente.
    res.status(201).json({ data: { date, reason: reason ?? null, source: 'painel' }, activeReservations: repos.reservations.countActiveOn(date) });
  });

  router.delete('/closed-dates/:date', requireAdmin, validate({ params: closedDateParam }), (req, res) => {
    const { date } = req.valid.params;
    if (site.reservations.closedDates.includes(date)) {
      throw conflict('Esta data está fixa no arquivo de configuração (config/site.config.js).');
    }
    if (!repos.closedDates.remove(date)) throw notFound('Data não encontrada.');
    repos.audit.log({ ...ctx(req), action: 'closed_date.deleted', entity: 'closed_date', entityId: date });
    res.status(204).end();
  });

  // ---------------------------------------------------------------------------
  //  Cardápio
  // ---------------------------------------------------------------------------
  router.get('/menu', requireAdmin, (_req, res) => res.json({ data: serializeMenu(repos) }));

  router.post('/menu/categories', requireAdmin, validate({ body: categoryInput }), (req, res) => {
    const id = withUniqueSlug(() => repos.menu.createCategory(req.valid.body));
    repos.audit.log({ ...ctx(req), action: 'menu.category_created', entity: 'menu_category', entityId: id });
    res.status(201).json({ data: repos.menu.findCategory(id) });
  });

  router.put('/menu/categories/:id', requireAdmin, validate({ params: idParam, body: categoryInput }), (req, res) => {
    const { id } = req.valid.params;
    const changes = withUniqueSlug(() => repos.menu.updateCategory(id, req.valid.body));
    if (!changes) throw notFound('Categoria não encontrada.');
    repos.audit.log({ ...ctx(req), action: 'menu.category_updated', entity: 'menu_category', entityId: id });
    res.json({ data: repos.menu.findCategory(id) });
  });

  router.delete('/menu/categories/:id', requireAdmin, validate({ params: idParam }), (req, res) => {
    const { id } = req.valid.params;
    if (repos.menu.countItemsInCategory(id) > 0) {
      throw conflict('Remova ou mova os itens desta categoria antes de excluí-la.');
    }
    if (!repos.menu.deleteCategory(id)) throw notFound('Categoria não encontrada.');
    repos.audit.log({ ...ctx(req), action: 'menu.category_deleted', entity: 'menu_category', entityId: id });
    res.status(204).end();
  });

  router.post('/menu/items', requireAdmin, validate({ body: menuItemInput }), (req, res) => {
    ensureCategory(req.valid.body.categoryId);
    const id = repos.menu.createItem(req.valid.body);
    repos.audit.log({ ...ctx(req), action: 'menu.item_created', entity: 'menu_item', entityId: id, details: { name: req.valid.body.name } });
    res.status(201).json({ data: repos.menu.findItem(id) });
  });

  router.put('/menu/items/:id', requireAdmin, validate({ params: idParam, body: menuItemInput }), (req, res) => {
    const { id } = req.valid.params;
    ensureCategory(req.valid.body.categoryId);
    if (!repos.menu.updateItem(id, req.valid.body)) throw notFound('Item não encontrado.');
    repos.audit.log({ ...ctx(req), action: 'menu.item_updated', entity: 'menu_item', entityId: id, details: { name: req.valid.body.name } });
    res.json({ data: repos.menu.findItem(id) });
  });

  router.delete('/menu/items/:id', requireAdmin, validate({ params: idParam }), (req, res) => {
    const { id } = req.valid.params;
    const item = repos.menu.findItem(id);
    if (!item) throw notFound('Item não encontrado.');
    repos.menu.deleteItem(id);
    repos.audit.log({ ...ctx(req), action: 'menu.item_deleted', entity: 'menu_item', entityId: id, details: { name: item.name } });
    res.status(204).end();
  });

  // ---------------------------------------------------------------------------
  //  Auditoria (somente proprietário)
  // ---------------------------------------------------------------------------
  router.get('/audit', requireAdmin, requireOwner, (_req, res) => {
    res.json({ data: repos.audit.recent(100).map((a) => ({ ...a, details: a.details ? JSON.parse(a.details) : null })) });
  });

  function ensureCategory(id) {
    if (!repos.menu.findCategory(id)) throw unprocessable('Categoria inexistente.');
  }

  return router;
}

function withUniqueSlug(fn) {
  try {
    return fn();
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed: menu_categories.slug')) {
      throw conflict('Já existe uma categoria com este identificador (slug).');
    }
    throw err;
  }
}

/** Célula CSV segura: escapa aspas e neutraliza injeção de fórmulas no Excel. */
function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function siteSummary(site) {
  return {
    name: site.brand.name,
    timezone: site.timezone,
    experiences: site.reservations.experiences.map(({ id, name }) => ({ id, name })),
    whatsapp: site.contact.whatsapp,
  };
}

