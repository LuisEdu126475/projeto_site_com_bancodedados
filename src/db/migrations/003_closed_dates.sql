-- =============================================================================
--  003_closed_dates.sql · Datas sem reservas gerenciadas pelo painel
-- -----------------------------------------------------------------------------
--  Complementa `reservations.closedDates` do config/site.config.js: a equipe
--  bloqueia feriados, eventos fechados e reformas direto no /admin, sem mexer
--  em código. O motivo é interno (o público só vê "fechado nesta data").
-- =============================================================================
CREATE TABLE closed_dates (
  date       TEXT    PRIMARY KEY CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  reason     TEXT    CHECK (reason IS NULL OR length(reason) <= 120),
  created_by INTEGER REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
