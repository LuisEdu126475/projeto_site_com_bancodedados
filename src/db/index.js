import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import logger from '../utils/logger.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Abre o banco SQLite (motor nativo do Node, sem binários a compilar)
 * com as configurações recomendadas para aplicações web:
 *  - WAL: leituras simultâneas sem bloquear escritas
 *  - foreign_keys: integridade referencial
 *  - busy_timeout: espera em vez de falhar sob concorrência
 *  - defensive: impede comandos que podem corromper o arquivo
 */
export function openDatabase(filename) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
  `);
  db.enableDefensive?.(true);
  return db;
}

/**
 * Executa `fn` em uma transação IMMEDIATE (trava de escrita adquirida
 * no início), o que elimina condições de corrida, por exemplo, duas reservas
 * disputando a última vaga do mesmo horário.
 */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* a transação já foi encerrada pelo próprio SQLite */
    }
    throw err;
  }
}

/**
 * Aplica, em ordem, os arquivos .sql de src/db/migrations ainda não executados.
 * Cada migração roda em sua própria transação e é registrada em schema_migrations.
 */
export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
  `);

  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_[\w-]+\.sql$/.test(f))
    .sort();

  const executed = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    transaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
    });
    executed.push(file);
    logger.info({ migration: file }, 'Migração aplicada');
  }
  return executed;
}
