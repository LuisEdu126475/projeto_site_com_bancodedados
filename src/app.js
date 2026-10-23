import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';

import defaultEnv from './config/env.js';
import defaultSite from './config/site.js';
import { createRepositories } from './db/repositories.js';
import { createAvailabilityService } from './services/availability.service.js';
import { createReservationService } from './services/reservation.service.js';
import { createAuthService } from './services/auth.service.js';
import {
  createRateLimiters,
  permissionsPolicy,
  sameOriginGuard,
  securityHeaders,
} from './middleware/security.js';
import { loadSession } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { publicApiRouter } from './routes/public.api.js';
import { adminApiRouter } from './routes/admin.api.js';
import { pagesRouter } from './routes/pages.js';
import logger from './utils/logger.js';
import { hasThemeOverrides, themeColor } from './utils/theme.js';
import { buildLinks, buildStoreData, isPublicUrl, jsonForScript } from './utils/channels.js';
import { openingStatus } from './utils/time.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const VIEWS_DIR = path.resolve(__dirname, 'views');

/**
 * Monta a aplicação Express. Recebe dependências por parâmetro para permitir
 * testes rápidos e isolados com banco em memória.
 */
export function createApp({
  db,
  env = defaultEnv,
  site = defaultSite,
  clock,
  enableRateLimit = !env.isTest,
  staticBuild = false, // true ao gerar a amostra estática (scripts/build-static.js)
} = {}) {
  if (!db) throw new Error('createApp requires a database instance');

  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.set('views', VIEWS_DIR);
  app.set('view engine', 'ejs');

  const repos = createRepositories(db);
  const availability = createAvailabilityService({ site, repos, clock });
  const reservations = createReservationService({ db, site, repos, availability, clock });
  const auth = createAuthService({ repos, env });
  const services = { availability, reservations, auth };
  const limiters = createRateLimiters({ enabled: enableRateLimit });

  // Variáveis disponíveis em todos os templates EJS. Ficam em app.locals (e
  // não só em res.locals) para existirem até numa página de erro gerada antes
  // do restante da cadeia de middlewares.
  Object.assign(app.locals, {
    site,
    links: buildLinks(site),
    demoMode: Boolean(env.DEMO_MODE),
    staticMode: Boolean(staticBuild),
    hasThemeOverrides: hasThemeOverrides(site.theme),
    themeColor: themeColor(site.theme),
    publicUrlKnown: isPublicUrl(site.seo.url),
    currentPath: '/',
  });
  // Calculados só quando uma página é renderizada (nunca para CSS, JS ou imagens).
  Object.defineProperties(app.locals, {
    // "Aberto agora" depende da hora da visita: no HTML estático o próprio
    // navegador calcula (ver public/js/main.js), então aqui fica vazio.
    liveStatus: {
      enumerable: true,
      get: () => (staticBuild ? null : openingStatus(site.hours, site.timezone, clock ? clock() : new Date())),
    },
    storeDataJson: {
      enumerable: true,
      get: () =>
        jsonForScript(
          buildStoreData(site, {
            closedDates: staticBuild ? availability.closedDates().map((d) => d.date) : [],
          }),
        ),
    },
  });
  app.use((req, res, next) => {
    res.locals.currentPath = req.path;
    next();
  });

  // Redirecionamento HTTPS opcional atrás de proxy reverso.
  // O destino é SEMPRE o domínio configurado (PUBLIC_URL), nunca o cabeçalho
  // Host enviado pelo visitante: assim ninguém usa o site para redirecionar
  // pessoas a um domínio falso (open redirect / host header injection).
  if (env.FORCE_HTTPS) {
    const httpsOrigin = canonicalHttpsOrigin(site.seo.url);
    app.use((req, res, next) => {
      if (req.secure || req.get('x-forwarded-proto') === 'https') return next();
      return res.redirect(308, `${httpsOrigin}${req.originalUrl}`);
    });
  }

  if (!env.isTest) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));
  }

  // Aviso de configuração: há um proxy na frente (Cloudflare, Nginx, Render,
  // Railway...) mas TRUST_PROXY=0. Nesse caso todos os visitantes parecem ter
  // o mesmo IP e os limites anti-abuso acabam bloqueando clientes legítimos.
  if (!env.isTest && env.TRUST_PROXY === 0) {
    let warned = false;
    app.use((req, _res, next) => {
      if (!warned && req.get('x-forwarded-for')) {
        warned = true;
        logger.warn(
          'Requisição com X-Forwarded-For e TRUST_PROXY=0. Se o site está atrás de um proxy (Cloudflare, Nginx, Render, Railway), defina TRUST_PROXY=1 no .env.',
        );
      }
      next();
    });
  }

  app.use(securityHeaders(env));
  app.use(permissionsPolicy);
  app.use(compression());

  // Arquivos estáticos servidos antes de sessão/cookies para máxima performance
  app.use(
    express.static(PUBLIC_DIR, {
      maxAge: env.isProduction ? '7d' : 0,
      etag: true,
    }),
  );

  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(cookieParser());
  app.use(loadSession({ auth, env }));

  const allowedOrigins = site.seo?.url ? [site.seo.url] : [];
  app.use('/api', limiters.api, sameOriginGuard(allowedOrigins));
  app.use('/api', publicApiRouter({ db, site, repos, services, limiters }));
  app.use('/api/admin', adminApiRouter({ env, site, repos, services, limiters, clock }));
  app.use('/', pagesRouter({ site, repos, services }));

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.repos = repos;
  app.locals.services = services;
  return app;
}

/** "https://www.cafe.com.br/qualquer" → "https://www.cafe.com.br" (recusa localhost). */
export function canonicalHttpsOrigin(publicUrl) {
  let host;
  try {
    const url = new URL(publicUrl);
    if (!['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)) host = url.host;
  } catch {
    /* tratado abaixo */
  }
  if (!host) {
    throw new Error(
      'FORCE_HTTPS=true exige PUBLIC_URL com o domínio público do site (ex.: PUBLIC_URL=https://www.suacafeteria.com.br).',
    );
  }
  return `https://${host}`;
}
