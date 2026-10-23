-- =============================================================================
--  001_initial.sql · Esquema inicial
-- -----------------------------------------------------------------------------
--  Princípios:
--   • Tabelas STRICT: o SQLite rejeita tipos incorretos (sem coerção silenciosa)
--   • CHECK constraints: o banco é a última linha de defesa da integridade
--   • Datas em ISO-8601 UTC (created_at/updated_at) e datas de reserva no
--     fuso da loja (reservation_date / reservation_time)
--   • Valores monetários em centavos (INTEGER), nunca ponto flutuante
--   • Dados pessoais mínimos e anonimizáveis (LGPD)
-- =============================================================================

-- -----------------------------------------------------------------------------
--  Usuários do painel administrativo
-- -----------------------------------------------------------------------------
CREATE TABLE admin_users (
  id              INTEGER PRIMARY KEY,
  email           TEXT    NOT NULL COLLATE NOCASE UNIQUE
                          CHECK (length(email) BETWEEN 5 AND 254 AND email LIKE '%_@_%._%'),
  name            TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  password_hash   TEXT    NOT NULL CHECK (password_hash LIKE 'scrypt$%'),
  role            TEXT    NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager')),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- -----------------------------------------------------------------------------
--  Sessões do painel: o token NUNCA é salvo em claro, apenas seu SHA-256.
--  Assim, um vazamento do banco não permite sequestrar sessões.
-- -----------------------------------------------------------------------------
CREATE TABLE sessions (
  id           TEXT    PRIMARY KEY CHECK (length(id) = 64),
  user_id      INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  csrf_token   TEXT    NOT NULL CHECK (length(csrf_token) >= 32),
  ip_hash      TEXT,
  user_agent   TEXT    CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at   TEXT    NOT NULL
) STRICT;

CREATE INDEX idx_sessions_user    ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- -----------------------------------------------------------------------------
--  Cardápio
-- -----------------------------------------------------------------------------
CREATE TABLE menu_categories (
  id          INTEGER PRIMARY KEY,
  slug        TEXT    NOT NULL UNIQUE CHECK (slug GLOB '[a-z0-9]*' AND slug NOT GLOB '*[^a-z0-9-]*'),
  name        TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 60),
  description TEXT    CHECK (description IS NULL OR length(description) <= 240),
  position    INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE menu_items (
  id            INTEGER PRIMARY KEY,
  category_id   INTEGER NOT NULL REFERENCES menu_categories (id) ON DELETE RESTRICT,
  name          TEXT    NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 80),
  origin        TEXT    CHECK (origin IS NULL OR length(origin) <= 80),
  description   TEXT    CHECK (description IS NULL OR length(description) <= 400),
  tasting_notes TEXT    CHECK (tasting_notes IS NULL OR length(tasting_notes) <= 120),
  volume        TEXT    CHECK (volume IS NULL OR length(volume) <= 20),
  price_cents   INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 1000000),
  is_signature  INTEGER NOT NULL DEFAULT 0 CHECK (is_signature IN (0, 1)),
  is_available  INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_menu_items_category ON menu_items (category_id, position);

-- -----------------------------------------------------------------------------
--  Reservas
-- -----------------------------------------------------------------------------
CREATE TABLE reservations (
  id               INTEGER PRIMARY KEY,
  code             TEXT    NOT NULL UNIQUE CHECK (length(code) = 8),
  customer_name    TEXT    NOT NULL CHECK (length(trim(customer_name)) BETWEEN 2 AND 80),
  customer_phone   TEXT    NOT NULL CHECK (customer_phone NOT GLOB '*[^0-9]*'
                                           AND length(customer_phone) BETWEEN 10 AND 13),
  customer_email   TEXT    CHECK (customer_email IS NULL OR length(customer_email) <= 254),
  party_size       INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 50),
  reservation_date TEXT    NOT NULL CHECK (reservation_date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  reservation_time TEXT    NOT NULL CHECK (reservation_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  experience       TEXT    NOT NULL CHECK (length(experience) BETWEEN 2 AND 30),
  notes            TEXT    CHECK (notes IS NULL OR length(notes) <= 500),
  status           TEXT    NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  internal_notes   TEXT    CHECK (internal_notes IS NULL OR length(internal_notes) <= 1000),
  consent_at       TEXT    NOT NULL,
  privacy_version  TEXT    NOT NULL,
  ip_hash          TEXT,
  anonymized_at    TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

-- Consulta de capacidade por horário (a mais frequente do sistema)
CREATE INDEX idx_reservations_slot   ON reservations (reservation_date, reservation_time, status);
-- Listagens do painel por status
CREATE INDEX idx_reservations_status ON reservations (status, reservation_date);
-- Detecção de reserva duplicada do mesmo cliente
CREATE INDEX idx_reservations_phone  ON reservations (customer_phone, reservation_date);
-- Anti-abuso por origem
CREATE INDEX idx_reservations_ip     ON reservations (ip_hash, created_at);

-- -----------------------------------------------------------------------------
--  Trilha de auditoria: quem fez o quê, e quando, no painel
-- -----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  action     TEXT    NOT NULL CHECK (length(action) BETWEEN 2 AND 60),
  entity     TEXT    NOT NULL CHECK (length(entity) BETWEEN 2 AND 40),
  entity_id  TEXT,
  details    TEXT    CHECK (details IS NULL OR json_valid(details)),
  ip_hash    TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_audit_created ON audit_log (created_at);
CREATE INDEX idx_audit_entity  ON audit_log (entity, entity_id);

-- -----------------------------------------------------------------------------
--  updated_at automático
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_admin_users_updated AFTER UPDATE ON admin_users
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE admin_users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_menu_categories_updated AFTER UPDATE ON menu_categories
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE menu_categories SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_menu_items_updated AFTER UPDATE ON menu_items
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE menu_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_reservations_updated AFTER UPDATE ON reservations
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE reservations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- A trilha de auditoria é somente-inclusão: não pode ser editada.
CREATE TRIGGER trg_audit_log_immutable BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log é imutável');
END;

