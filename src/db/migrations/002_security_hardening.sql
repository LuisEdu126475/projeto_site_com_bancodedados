-- =============================================================================
--  002_security_hardening.sql · Endurecimento de segurança
-- =============================================================================

-- -----------------------------------------------------------------------------
--  A trilha de auditoria também não pode ser APAGADA.
--  (A 001 já impedia a edição; faltava bloquear o DELETE.)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log é imutável');
END;

-- -----------------------------------------------------------------------------
--  Proteção do login em três camadas (nada aqui é dado pessoal em claro:
--  e-mails, IPs e tokens ficam só como hash SHA-256):
--
--  1. login_throttle: e-mail + conexão. Quem erra 5 vezes trava só a própria
--     conexão; o dono continua entrando de outro lugar.
--  2. login_account_guard: soma das tentativas na conta, de qualquer conexão.
--     Um ataque espalhado em muitos IPs também é contido.
--  3. trusted_devices: aparelhos que já fizeram login. Durante um ataque à
--     conta, eles continuam entrando; aparelhos novos esperam a restrição
--     acabar. Assim o atacante não consegue trancar o dono do lado de fora.
--  Também vale para e-mails inexistentes, para não revelar quais contas existem.
-- -----------------------------------------------------------------------------
CREATE TABLE login_throttle (
  key             TEXT    PRIMARY KEY CHECK (length(key) = 64),
  account         TEXT    NOT NULL CHECK (length(account) = 64),
  failures        INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  locked_until    TEXT,
  last_failure_at TEXT    NOT NULL
) STRICT;

CREATE INDEX idx_login_throttle_account ON login_throttle (account);
CREATE INDEX idx_login_throttle_last    ON login_throttle (last_failure_at);

CREATE TABLE login_account_guard (
  account           TEXT    PRIMARY KEY CHECK (length(account) = 64),
  failures          INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  window_started_at TEXT    NOT NULL,
  restricted_until  TEXT
) STRICT;

CREATE TABLE trusted_devices (
  token_hash   TEXT    PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id      INTEGER NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_trusted_devices_user ON trusted_devices (user_id);
