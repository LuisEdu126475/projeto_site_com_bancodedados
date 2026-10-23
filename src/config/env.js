import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Carrega e valida as variáveis de ambiente.
 * Usa o carregador nativo do Node (process.loadEnvFile), sem dependências.
 */
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile) && process.env.NODE_ENV !== 'test') {
  process.loadEnvFile(envFile);
}

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  PUBLIC_URL: z.url().optional(),
  DATABASE_PATH: z.string().default('./data/cafe.db'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  // Número de proxies reversos confiáveis à frente da aplicação (Nginx, Render, Railway…)
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  // Segredo usado para anonimizar IPs (HMAC). Obrigatório em produção.
  IP_HASH_SECRET: z.string().min(32).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  FORCE_HTTPS: bool.default(false),
  // Exibe o painel "Modo Demonstração" e o link do /admin na vitrine (uso comercial).
  // Deixe desligado (padrão) no site real do cliente.
  DEMO_MODE: bool.default(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('\n✖ Variáveis de ambiente inválidas:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('\n  Consulte o arquivo .env.example\n');
  process.exit(1);
}

const env = parsed.data;

if (env.NODE_ENV === 'production' && !env.IP_HASH_SECRET) {
  console.error('\n✖ IP_HASH_SECRET é obrigatório em produção (mínimo de 32 caracteres).');
  console.error('  Gere um com: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n');
  process.exit(1);
}

env.isProduction = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';
env.IP_HASH_SECRET ??= 'dev-only-insecure-secret-change-me-in-production';

export default Object.freeze(env);

