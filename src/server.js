import env from './config/env.js';
import site from './config/site.js';
import { DEMO_ADMIN_PASSWORD } from './config/demo.js';
import { openDatabase, migrate } from './db/index.js';
import { seedMenuIfEmpty } from './db/seed-data.js';
import { createApp } from './app.js';
import { verifyPassword } from './utils/crypto.js';
import logger from './utils/logger.js';

const db = openDatabase(env.DATABASE_PATH);
migrate(db);

let app;
try {
  app = createApp({ db, env, site });
} catch (err) {
  // Erros de configuração (ex.: FORCE_HTTPS sem PUBLIC_URL) com mensagem clara
  console.error(`\n✖ ${err.message}\n`);
  db.close();
  process.exit(1);
}
const { repos } = app.locals;

const seedResult = seedMenuIfEmpty(db, repos);
if (seedResult.seeded) {
  logger.info(
    { categories: seedResult.categories, items: seedResult.items },
    'Cardápio inicial criado a partir de config/cardapio.config.js',
  );
}

if (env.isProduction) {
  // Banco copiado do computador de testes para o servidor do cliente ainda
  // teria a senha pública de demonstração: o servidor não sobe assim.
  for (const user of repos.users.listAuth()) {
    if (await verifyPassword(DEMO_ADMIN_PASSWORD, user.password_hash)) {
      logger.fatal(
        { email: user.email },
        'Este banco ainda tem um administrador com a senha de DEMONSTRAÇÃO. Troque-a com "npm run admin:create -- --email=... --password=..." ou use um banco novo.',
      );
      db.close();
      process.exit(1);
    }
  }
  if (/localhost|127\.0\.0\.1/.test(site.seo.url)) {
    logger.warn('PUBLIC_URL não definido: links de compartilhamento e SEO apontam para localhost. Defina PUBLIC_URL no .env.');
  }
}

// Limpeza periódica (1x por hora): sessões expiradas e bloqueios de login antigos
function cleanup() {
  try {
    const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
    repos.sessions.purgeExpired();
    repos.loginThrottle.purgeStale(dayAgo);
    repos.accountGuard.purgeStale(dayAgo);
    // Aparelho sem login há mais de 180 dias deixa de ser "conhecido"
    repos.devices.purgeUnused(new Date(Date.now() - 180 * 86_400_000).toISOString());
  } catch (err) {
    logger.warn({ err }, 'Falha na limpeza periódica');
  }
}
cleanup();
const cleanupTimer = setInterval(cleanup, 60 * 60_000);
cleanupTimer.unref();

const server = app.listen(env.PORT, env.HOST, () => {
  const displayHost = env.HOST === '0.0.0.0' ? 'localhost' : env.HOST;
  const baseUrl = `http://${displayHost}:${env.PORT}`;
  logger.info(
    {
      brand: site.brand.name,
      url: baseUrl,
      admin: `${baseUrl}/admin`,
      env: env.NODE_ENV,
    },
    'Servidor iniciado',
  );

  if (env.DEMO_MODE && env.isProduction) {
    logger.warn('DEMO_MODE está ligado em produção: o painel de demonstração e o link do /admin ficam visíveis ao público.');
  }

  if (repos.users.count() === 0) {
    logger.warn(
      'Nenhum administrador cadastrado. Execute "npm run setup" ou "npm run admin:create" para criar seu acesso ao /admin.',
    );
  }
});

function shutdown(signal) {
  logger.info({ signal }, 'Encerrando servidor...');
  clearInterval(cleanupTimer);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

