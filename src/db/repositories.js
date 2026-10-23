/**
 * Camada de acesso a dados. Todas as consultas usam parâmetros vinculados
 * (prepared statements): não existe concatenação de valores em SQL,
 * o que elimina SQL injection por construção.
 */

const nowIso = () => new Date().toISOString();

export function createRepositories(db) {
  // ---------------------------------------------------------------------------
  //  Usuários administrativos
  // ---------------------------------------------------------------------------
  const users = {
    findByEmail: (email) => db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email),
    findById: (id) =>
      db
        .prepare('SELECT id, email, name, role, is_active, last_login_at, created_at FROM admin_users WHERE id = ?')
        .get(id),
    findAuthById: (id) => db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id),
    count: () => db.prepare('SELECT COUNT(*) AS n FROM admin_users').get().n,
    create: ({ email, name, passwordHash, role = 'manager' }) =>
      db
        .prepare('INSERT INTO admin_users (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(email, name, passwordHash, role).lastInsertRowid,
    updatePassword: (id, passwordHash) =>
      db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(passwordHash, id),
    registerFailure: (id, maxAttempts, lockMinutes) =>
      db
        .prepare(
          `UPDATE admin_users
              SET failed_attempts = failed_attempts + 1,
                  locked_until = CASE WHEN failed_attempts + 1 >= ?
                                      THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
                                      ELSE locked_until END
            WHERE id = ?`,
        )
        .run(maxAttempts, `+${lockMinutes} minutes`, id),
    registerSuccess: (id) =>
      db
        .prepare(
          'UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?',
        )
        .run(nowIso(), id),
    /** Zera contadores antigos de bloqueio (usado na redefinição de senha pelo terminal). */
    clearLock: (id) =>
      db.prepare('UPDATE admin_users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(id),
    /** Hashes de senha de todos os usuários (checagem de senha de demonstração em produção). */
    listAuth: () => db.prepare('SELECT id, email, password_hash FROM admin_users').all(),
  };

  // ---------------------------------------------------------------------------
  //  Bloqueio de login por e-mail + origem (ver migração 002)
  // ---------------------------------------------------------------------------
  const loginThrottle = {
    find: (key) => db.prepare('SELECT * FROM login_throttle WHERE key = ?').get(key),
    registerFailure: ({ key, account, maxAttempts, windowMinutes, lockMinutes }) => {
      const now = new Date();
      db.prepare(
        `INSERT INTO login_throttle (key, account, failures, locked_until, last_failure_at)
         VALUES (@key, @account, 1, CASE WHEN 1 >= @max THEN @lockUntil END, @now)
         ON CONFLICT (key) DO UPDATE SET
           failures = CASE WHEN last_failure_at < @windowStart THEN 1 ELSE failures + 1 END,
           locked_until = CASE
             WHEN (CASE WHEN last_failure_at < @windowStart THEN 1 ELSE failures + 1 END) >= @max THEN @lockUntil
             ELSE NULL END,
           last_failure_at = @now`,
      ).run({
        key,
        account,
        max: maxAttempts,
        now: now.toISOString(),
        windowStart: new Date(now.getTime() - windowMinutes * 60_000).toISOString(),
        lockUntil: new Date(now.getTime() + lockMinutes * 60_000).toISOString(),
      });
    },
    clear: (key) => db.prepare('DELETE FROM login_throttle WHERE key = ?').run(key),
    clearAccount: (account) => db.prepare('DELETE FROM login_throttle WHERE account = ?').run(account).changes,
    /** Remove registros sem falhas recentes (limpeza periódica). */
    purgeStale: (olderThanIso) =>
      db
        .prepare(
          `DELETE FROM login_throttle
            WHERE last_failure_at < ? AND (locked_until IS NULL OR locked_until < ?)`,
        )
        .run(olderThanIso, nowIso()).changes,
  };

  // ---------------------------------------------------------------------------
  //  Limite por conta, somando todas as conexões (migração 002)
  // ---------------------------------------------------------------------------
  const accountGuard = {
    find: (account) => db.prepare('SELECT * FROM login_account_guard WHERE account = ?').get(account),
    registerFailure: ({ account, maxAttempts, windowMinutes, restrictMinutes }) => {
      const now = new Date();
      db.prepare(
        `INSERT INTO login_account_guard (account, failures, window_started_at, restricted_until)
         VALUES (@account, 1, @now, CASE WHEN 1 >= @max THEN @restrictUntil END)
         ON CONFLICT (account) DO UPDATE SET
           failures = CASE WHEN window_started_at < @windowStart THEN 1 ELSE failures + 1 END,
           restricted_until = CASE
             WHEN (CASE WHEN window_started_at < @windowStart THEN 1 ELSE failures + 1 END) >= @max THEN @restrictUntil
             ELSE restricted_until END,
           window_started_at = CASE WHEN window_started_at < @windowStart THEN @now ELSE window_started_at END`,
      ).run({
        account,
        max: maxAttempts,
        now: now.toISOString(),
        windowStart: new Date(now.getTime() - windowMinutes * 60_000).toISOString(),
        restrictUntil: new Date(now.getTime() + restrictMinutes * 60_000).toISOString(),
      });
    },
    /** A senha estava certa: desfaz a tentativa contada antes da conferência. */
    undoFailure: (account) =>
      db.prepare('UPDATE login_account_guard SET failures = MAX(failures - 1, 0) WHERE account = ?').run(account),
    clear: (account) => db.prepare('DELETE FROM login_account_guard WHERE account = ?').run(account).changes,
    purgeStale: (olderThanIso) =>
      db
        .prepare(
          `DELETE FROM login_account_guard
            WHERE window_started_at < ? AND (restricted_until IS NULL OR restricted_until < ?)`,
        )
        .run(olderThanIso, nowIso()).changes,
  };

  // ---------------------------------------------------------------------------
  //  Aparelhos que já fizeram login (continuam entrando durante um ataque)
  // ---------------------------------------------------------------------------
  const devices = {
    isTrusted: (tokenHash, userId) =>
      Boolean(db.prepare('SELECT 1 FROM trusted_devices WHERE token_hash = ? AND user_id = ?').get(tokenHash, userId)),
    add: (tokenHash, userId) =>
      db.prepare('INSERT INTO trusted_devices (token_hash, user_id) VALUES (?, ?)').run(tokenHash, userId),
    touch: (tokenHash) =>
      db.prepare('UPDATE trusted_devices SET last_used_at = ? WHERE token_hash = ?').run(nowIso(), tokenHash),
    revokeAllForUser: (userId) => db.prepare('DELETE FROM trusted_devices WHERE user_id = ?').run(userId).changes,
    purgeUnused: (olderThanIso) =>
      db.prepare('DELETE FROM trusted_devices WHERE last_used_at < ?').run(olderThanIso).changes,
  };

  // ---------------------------------------------------------------------------
  //  Sessões
  // ---------------------------------------------------------------------------
  const sessions = {
    create: ({ id, userId, csrfToken, ipHash, userAgent, expiresAt }) =>
      db
        .prepare(
          'INSERT INTO sessions (id, user_id, csrf_token, ip_hash, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, userId, csrfToken, ipHash, userAgent, expiresAt),
    findValid: (id) =>
      db
        .prepare(
          `SELECT s.id, s.user_id, s.csrf_token, s.expires_at,
                  u.email, u.name, u.role, u.is_active
             FROM sessions s
             JOIN admin_users u ON u.id = s.user_id
            WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1`,
        )
        .get(id, nowIso()),
    touch: (id) => db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), id),
    delete: (id) => db.prepare('DELETE FROM sessions WHERE id = ?').run(id),
    deleteAllForUser: (userId, exceptId = '') =>
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, exceptId),
    purgeExpired: () => db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes,
  };

  // ---------------------------------------------------------------------------
  //  Cardápio
  // ---------------------------------------------------------------------------
  const menu = {
    listCategories: ({ onlyActive = false } = {}) =>
      db
        .prepare(
          `SELECT * FROM menu_categories ${onlyActive ? 'WHERE is_active = 1' : ''} ORDER BY position, name`,
        )
        .all(),
    findCategory: (id) => db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(id),
    createCategory: ({ slug, name, description, position, isActive }) =>
      db
        .prepare(
          'INSERT INTO menu_categories (slug, name, description, position, is_active) VALUES (?, ?, ?, ?, ?)',
        )
        .run(slug, name, description ?? null, position ?? 0, isActive === false ? 0 : 1).lastInsertRowid,
    updateCategory: (id, { slug, name, description, position, isActive }) =>
      db
        .prepare(
          `UPDATE menu_categories
              SET slug = ?, name = ?, description = ?, position = ?, is_active = ?
            WHERE id = ?`,
        )
        .run(slug, name, description ?? null, position ?? 0, isActive === false ? 0 : 1, id).changes,
    deleteCategory: (id) => db.prepare('DELETE FROM menu_categories WHERE id = ?').run(id).changes,
    countItemsInCategory: (id) =>
      db.prepare('SELECT COUNT(*) AS n FROM menu_items WHERE category_id = ?').get(id).n,

    listItems: ({ onlyAvailable = false } = {}) =>
      db
        .prepare(
          `SELECT i.* FROM menu_items i
             JOIN menu_categories c ON c.id = i.category_id
            ${onlyAvailable ? 'WHERE i.is_available = 1 AND c.is_active = 1' : ''}
            ORDER BY c.position, i.position, i.name`,
        )
        .all(),
    findItem: (id) => db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id),
    createItem: (item) =>
      db
        .prepare(
          `INSERT INTO menu_items
             (category_id, name, origin, description, tasting_notes, volume, price_cents, is_signature, is_available, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(...itemParams(item)).lastInsertRowid,
    updateItem: (id, item) =>
      db
        .prepare(
          `UPDATE menu_items
              SET category_id = ?, name = ?, origin = ?, description = ?, tasting_notes = ?,
                  volume = ?, price_cents = ?, is_signature = ?, is_available = ?, position = ?
            WHERE id = ?`,
        )
        .run(...itemParams(item), id).changes,
    deleteItem: (id) => db.prepare('DELETE FROM menu_items WHERE id = ?').run(id).changes,
  };

  // ---------------------------------------------------------------------------
  //  Reservas
  // ---------------------------------------------------------------------------
  const ACTIVE = "('pending', 'confirmed', 'seated')";

  const reservations = {
    guestsBySlot: (date) =>
      db
        .prepare(
          `SELECT reservation_time AS time, SUM(party_size) AS guests
             FROM reservations
            WHERE reservation_date = ? AND status IN ${ACTIVE}
            GROUP BY reservation_time`,
        )
        .all(date),
    guestsAt: (date, time) =>
      db
        .prepare(
          `SELECT COALESCE(SUM(party_size), 0) AS guests
             FROM reservations
            WHERE reservation_date = ? AND reservation_time = ? AND status IN ${ACTIVE}`,
        )
        .get(date, time).guests,
    hasActiveForPhone: (phone, date) =>
      Boolean(
        db
          .prepare(
            `SELECT 1 FROM reservations
              WHERE customer_phone = ? AND reservation_date = ? AND status IN ${ACTIVE} LIMIT 1`,
          )
          .get(phone, date),
      ),
    countRecentByIp: (ipHash, minutes) =>
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM reservations
            WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`,
        )
        .get(ipHash, `-${minutes} minutes`).n,
    codeExists: (code) => Boolean(db.prepare('SELECT 1 FROM reservations WHERE code = ?').get(code)),
    create: (r) =>
      db
        .prepare(
          `INSERT INTO reservations
             (code, customer_name, customer_phone, customer_email, party_size, reservation_date,
              reservation_time, experience, notes, consent_at, privacy_version, ip_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          r.code,
          r.name,
          r.phone,
          r.email ?? null,
          r.partySize,
          r.date,
          r.time,
          r.experience,
          r.notes ?? null,
          nowIso(),
          r.privacyVersion,
          r.ipHash ?? null,
        ).lastInsertRowid,
    findById: (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id),
    findByCode: (code) => db.prepare('SELECT * FROM reservations WHERE code = ?').get(code),

    list: ({ from, to, status, search, limit, offset }) => {
      const where = [];
      const params = [];
      if (from) where.push('reservation_date >= ?') && params.push(from);
      if (to) where.push('reservation_date <= ?') && params.push(to);
      if (status) where.push('status = ?') && params.push(status);
      if (search) {
        where.push("(customer_name LIKE ? ESCAPE '\\' OR customer_phone LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\')");
        const like = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        params.push(like, like, like);
      }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = db.prepare(`SELECT COUNT(*) AS n FROM reservations ${clause}`).get(...params).n;
      const rows = db
        .prepare(
          `SELECT * FROM reservations ${clause}
            ORDER BY reservation_date ASC, reservation_time ASC, id ASC
            LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
      return { total, rows };
    },
    update: (id, { status, internalNotes }) =>
      db
        .prepare(
          `UPDATE reservations
              SET status = COALESCE(?, status),
                  internal_notes = CASE WHEN ? THEN ? ELSE internal_notes END
            WHERE id = ?`,
        )
        .run(status ?? null, internalNotes !== undefined ? 1 : 0, internalNotes ?? null, id).changes,

    stats: (today, weekEnd) =>
      db
        .prepare(
          `SELECT
             COUNT(*) FILTER (WHERE reservation_date = ? AND status IN ${ACTIVE})            AS today_count,
             COALESCE(SUM(party_size) FILTER (WHERE reservation_date = ? AND status IN ${ACTIVE}), 0) AS today_guests,
             COUNT(*) FILTER (WHERE status = 'pending' AND reservation_date >= ?)            AS pending_count,
             COUNT(*) FILTER (WHERE reservation_date BETWEEN ? AND ? AND status IN ${ACTIVE}) AS week_count,
             COALESCE(SUM(party_size) FILTER (WHERE reservation_date BETWEEN ? AND ? AND status IN ${ACTIVE}), 0) AS week_guests,
             COALESCE(MAX(id), 0)                                                           AS latest_id,
             COUNT(*)                                                                        AS total_count,
             COALESCE(MAX(updated_at), '')                                                   AS latest_update
           FROM reservations`,
        )
        .get(today, today, today, today, weekEnd, today, weekEnd),

    countActiveOn: (date) =>
      db
        .prepare(`SELECT COUNT(*) AS n FROM reservations WHERE reservation_date = ? AND status IN ${ACTIVE}`)
        .get(date).n,

    /** LGPD: substitui dados pessoais de reservas antigas por valores neutros. */
    anonymizeOlderThan: (isoDate) =>
      db
        .prepare(
          `UPDATE reservations
              SET customer_name = 'Titular anonimizado',
                  customer_phone = '0000000000',
                  customer_email = NULL,
                  notes = NULL,
                  internal_notes = NULL,
                  ip_hash = NULL,
                  anonymized_at = ?
            WHERE reservation_date < ? AND anonymized_at IS NULL`,
        )
        .run(nowIso(), isoDate).changes,
  };

  // ---------------------------------------------------------------------------
  //  Datas sem reservas definidas pelo painel (migração 003)
  // ---------------------------------------------------------------------------
  const closedDates = {
    has: (date) => Boolean(db.prepare('SELECT 1 FROM closed_dates WHERE date = ?').get(date)),
    listFrom: (fromDate) =>
      db.prepare('SELECT date, reason, created_at FROM closed_dates WHERE date >= ? ORDER BY date').all(fromDate),
    add: ({ date, reason, userId }) =>
      db
        .prepare('INSERT INTO closed_dates (date, reason, created_by) VALUES (?, ?, ?)')
        .run(date, reason ?? null, userId ?? null),
    remove: (date) => db.prepare('DELETE FROM closed_dates WHERE date = ?').run(date).changes,
  };

  // ---------------------------------------------------------------------------
  //  Auditoria
  // ---------------------------------------------------------------------------
  const audit = {
    log: ({ userId, action, entity, entityId, details, ipHash }) =>
      db
        .prepare(
          'INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip_hash) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          userId ?? null,
          action,
          entity,
          entityId == null ? null : String(entityId),
          details ? JSON.stringify(details) : null,
          ipHash ?? null,
        ),
    recent: (limit = 50) =>
      db
        .prepare(
          `SELECT a.id, a.action, a.entity, a.entity_id, a.details, a.created_at, u.name AS user_name
             FROM audit_log a LEFT JOIN admin_users u ON u.id = a.user_id
            ORDER BY a.id DESC LIMIT ?`,
        )
        .all(limit),
  };

  return { users, loginThrottle, accountGuard, devices, sessions, menu, reservations, closedDates, audit };
}

function itemParams(i) {
  return [
    i.categoryId,
    i.name,
    i.origin ?? null,
    i.description ?? null,
    i.tastingNotes ?? null,
    i.volume ?? null,
    i.priceCents,
    i.isSignature ? 1 : 0,
    i.isAvailable === false ? 0 : 1,
    i.position ?? 0,
  ];
}

