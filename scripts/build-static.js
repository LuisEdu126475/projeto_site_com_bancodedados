/**
 * Gera a versão SEM BANCO do site (HTML + CSS + JS + imagens), pronta para
 * qualquer hospedagem (Hostinger, Netlify, Cloudflare Pages, GitHub Pages...)
 * ou para abrir direto no navegador com dois cliques em index.html.
 *
 * Como funciona: sobe a própria aplicação em uma porta temporária, captura as
 * páginas já renderizadas e grava tudo na pasta de saída. Na versão estática:
 *  • o cardápio vem de config/cardapio.config.js;
 *  • "Aberto agora" e os horários de reserva são calculados no navegador;
 *  • pedidos e reservas seguem pelo WhatsApp da casa (sem checar vagas).
 *
 * Uso:
 *   npm run build:static -- --url=https://www.cafeteriadocliente.com.br
 *   npm run build:static -- --url=https://... --out=clientes/cafe-x
 *   npm run build:static -- --demo            (amostra de vendas com o painel "Personalizar")
 *
 * Opções:
 *   --url=URL     endereço público final (canonical, prévia no WhatsApp, sitemap)
 *   --out=DIR     pasta de saída (padrão: dist)
 *   --db[=ARQ]    usa o cardápio editado no /admin (banco SQLite; padrão: DATABASE_PATH).
 *                 O banco original nunca é alterado: o build lê uma cópia.
 *   --demo        mantém o painel "Personalizar demonstração" e os modelos de cardápio
 *   --force       substitui a pasta de saída mesmo com arquivos editados à mão
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [key, ...rest] = a.slice(2).split('=');
      return [key, rest.length ? rest.join('=') : 'true'];
    }),
);

const fail = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
};

if (args.url) {
  let parsed;
  try {
    parsed = new URL(args.url);
  } catch {
    fail(`--url inválida: ${args.url}\n  Use o endereço completo, ex.: --url=https://www.cafeteriadocliente.com.br`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) fail('--url precisa começar com https://');
  // Precisa ser definido ANTES de carregar src/config/env.js e site.js
  process.env.PUBLIC_URL = parsed.origin + parsed.pathname.replace(/\/+$/, '');
}
process.env.DEMO_MODE = args.demo ? 'true' : 'false';
process.env.LOG_LEVEL ??= 'warn'; // sem o log de cada migração no terminal

const { default: env } = await import('../src/config/env.js');
const { default: site } = await import('../src/config/site.js');
const { openDatabase, migrate } = await import('../src/db/index.js');
const { seedMenuIfEmpty } = await import('../src/db/seed-data.js');
const { createApp } = await import('../src/app.js');
const { hasThemeOverrides } = await import('../src/utils/theme.js');

const ROOT = process.cwd();
const outDir = path.resolve(args.out ?? 'dist');
const publicDir = path.resolve('public');
const MANIFEST = '.build-manifest.json';
// Arquivos que o sistema operacional cria sozinho: não contam como "edição à mão".
const OS_JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|\._[^/]*)$/i;

const isInside = (child, parent) => {
  const r = path.relative(parent, child);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};
const shown = (p) => path.relative(ROOT, p) || p;

// Segurança: a pasta de saída é apagada e recriada, então nunca pode ser (nem
// conter, nem ficar dentro de) a pasta do projeto, o código, as fotos ou o banco.
const dbSource = args.db ? path.resolve(args.db === 'true' ? env.DATABASE_PATH : args.db) : null;
const protectedDirs = ['public', 'src', 'config', 'scripts', 'tests', 'node_modules', 'data', 'backups', '.git']
  .map((d) => path.resolve(ROOT, d))
  .concat(path.dirname(path.resolve(env.DATABASE_PATH)), dbSource ? [path.dirname(dbSource)] : []);
if (isInside(ROOT, outDir) || protectedDirs.some((d) => isInside(outDir, d) || isInside(d, outDir))) {
  fail(`Pasta de saída inválida: ${outDir}\n  Ela não pode ser a pasta do projeto, do código, das fotos ou do banco.\n  Use, por exemplo: --out=dist ou --out=../sites/cafe-aurora`);
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
}

/**
 * Proteção contra perder trabalho:
 *  • pasta com arquivos que NÃO foram criados por este gerador: nunca é apagada;
 *  • pasta criada pelo gerador mas editada à mão depois: só com --force.
 */
function assertSafeToReplace() {
  if (!fs.existsSync(outDir)) return;
  if (!fs.statSync(outDir).isDirectory()) fail(`${shown(outDir)} já existe e não é uma pasta.`);
  const files = listFiles(outDir).filter((f) => !OS_JUNK.test(f));
  if (!files.length) return;
  const manifestPath = path.join(outDir, MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    fail(
      `A pasta ${shown(outDir)} já tem arquivos que não foram criados por este gerador.\n` +
        '  Por segurança ela não é apagada (nem com --force) e nada foi alterado.\n' +
        '  Gere em uma pasta nova (--out=outra-pasta) ou apague/renomeie essa pasta você mesmo.',
    );
  }
  if (args.force) return;
  let known = {};
  try {
    known = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files ?? {};
  } catch {
    /* manifesto ilegível: tudo conta como alterado */
  }
  const changed = files.filter((f) => f !== MANIFEST && known[f] !== sha256(fs.readFileSync(path.join(outDir, f))));
  if (changed.length) {
    fail(
      `Há arquivos alterados à mão desde o último build em ${shown(outDir)}:\n` +
        changed
          .slice(0, 10)
          .map((f) => `    • ${f}`)
          .join('\n') +
        '\n  Gerar de novo apagaria essas mudanças, então nada foi alterado.\n' +
        '  Leve as mudanças para config/ (site.config.js e cardapio.config.js) ou salve uma cópia,\n' +
        '  e rode de novo com --force para substituir só esta pasta.',
    );
  }
}

assertSafeToReplace();

// Pastas temporárias (cópia do banco e build em andamento) somem em qualquer
// saída, inclusive em erro: a cópia do banco tem dados pessoais de clientes.
const tempPaths = [];
process.on('exit', () => {
  for (const p of tempPaths) fs.rmSync(p, { recursive: true, force: true });
});

// --- Cardápio: arquivo de configuração (padrão) ou cópia do banco (--db) ----
let dbFile = ':memory:';
let menuSource = 'config/cardapio.config.js';
if (dbSource) {
  const source = dbSource;
  if (!fs.existsSync(source)) fail(`Banco não encontrado: ${source}`);
  // Snapshot consistente (inclui o que ainda está no WAL) sem tocar no original.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafe-build-'));
  tempPaths.push(tempDir);
  dbFile = path.join(tempDir, 'snapshot.db');
  const { DatabaseSync } = await import('node:sqlite');
  const reader = new DatabaseSync(source, { readOnly: true });
  reader.exec(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
  reader.close();
  menuSource = `${shown(source)} (cópia; o banco original não foi alterado)`;
}

const db = openDatabase(dbFile);
migrate(db);

const app = createApp({
  db,
  // Ambiente neutro: sem redirecionar para HTTPS, sem logs e sem rate limit.
  env: { ...env, FORCE_HTTPS: false, TRUST_PROXY: 0, isTest: true, isProduction: false },
  site,
  staticBuild: true,
  enableRateLimit: false,
});
seedMenuIfEmpty(db, app.locals.repos);

const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function capture(route) {
  const res = await fetch(`${base}${route}`);
  if (!res.ok) throw new Error(`${route} respondeu ${res.status}`);
  return res.text();
}

/** O caminho (sem ?query/#âncora) aponta para um arquivo dentro de public/? */
function existsInPublic(file) {
  try {
    const full = path.resolve(publicDir, decodeURIComponent(file.split(/[?#]/)[0]));
    return isInside(full, publicDir) && fs.existsSync(full) && fs.statSync(full).isFile();
  } catch {
    return false;
  }
}

/** Troca os caminhos absolutos do servidor (/css/..., /#menu) por relativos. */
function toRelativeHtml(html) {
  const out = html
    .replace(/(href|src)="\/#/g, '$1="index.html#')
    .replace(/href="\/privacidade"/g, 'href="privacidade.html"')
    .replace(/href="\/"/g, 'href="index.html"')
    .replace(/<script type="module" src="\/js\/main\.js"><\/script>/g, '<script defer src="js/main.js"></script>')
    .replace(/(href|src)="\/(css|js|fonts|images|favicon\.svg|site\.webmanifest)/g, '$1="$2')
    // Outras pastas que você criar dentro de public/ (ex.: /fotos/fachada.jpg) também viram relativas
    .replace(/(href|src)="\/(?!\/)([^"]+)"/g, (match, attr, file) => (existsInPublic(file) ? `${attr}="${file}"` : match));
  // Qualquer caminho absoluto que sobrar quebraria no estático: melhor falhar aqui.
  const leftover = out.match(/(?:href|src)="\/(?!\/)[^"]*"/);
  if (leftover) throw new Error(`Caminho absoluto não convertido no HTML estático: ${leftover[0]}`);
  return out;
}

/** Cabeçalhos de segurança equivalentes aos do servidor Node (src/middleware/security.js). */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "manifest-src 'self'",
  'upgrade-insecure-requests',
].join('; ');
const SECURITY_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};

const netlifyHeaders = [
  '# Cabeçalhos de segurança para Netlify e Cloudflare Pages (lidos automaticamente).',
  '/*',
  ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  ${k}: ${v}`),
  '',
  '/images/*',
  '  Cache-Control: public, max-age=604800',
  '/fonts/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
].join('\n');

const htaccess = [
  '# Cabeçalhos de segurança e cache para hospedagens Apache/LiteSpeed',
  '# (Hostinger, Locaweb, HostGator, KingHost e outros painéis cPanel).',
  'Options -Indexes',
  '',
  '<IfModule mod_headers.c>',
  ...Object.entries(SECURITY_HEADERS).map(([k, v]) => `  Header always set ${k} "${v}"`),
  '</IfModule>',
  '',
  '<IfModule mod_expires.c>',
  '  ExpiresActive On',
  '  ExpiresByType image/jpeg "access plus 7 days"',
  '  ExpiresByType image/svg+xml "access plus 7 days"',
  '  ExpiresByType font/woff2 "access plus 1 year"',
  '  ExpiresByType text/css "access plus 1 day"',
  '  ExpiresByType text/javascript "access plus 1 day"',
  '  ExpiresByType application/javascript "access plus 1 day"',
  '</IfModule>',
  '',
  '<IfModule mod_mime.c>',
  '  AddType application/manifest+json .webmanifest',
  '</IfModule>',
  '',
].join('\n');

// O site é montado numa pasta temporária ao lado da final e só substitui a
// anterior no fim, já validado: se algo falhar, o último site bom continua intacto.
const stageDir = path.join(path.dirname(outDir), `.${path.basename(outDir)}.gerando-${process.pid}`);
tempPaths.push(stageDir);

try {
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });

  // Arquivos estáticos (sem o painel administrativo)
  fs.cpSync(publicDir, stageDir, {
    recursive: true,
    filter: (src) => !/[\\/]admin\.(css|js)$/.test(src),
  });

  // Fontes referenciadas pelo CSS com caminho absoluto -> relativo à pasta css/
  const tokensPath = path.join(stageDir, 'css', 'tokens.css');
  fs.writeFileSync(tokensPath, fs.readFileSync(tokensPath, 'utf8').replace(/url\((['"]?)\//g, 'url($1../'));

  // Páginas
  fs.writeFileSync(path.join(stageDir, 'index.html'), toRelativeHtml(await capture('/')));
  fs.writeFileSync(
    path.join(stageDir, 'privacidade.html'),
    // No estático a página é um arquivo .html (canonical e og:url precisam apontar para ele)
    toRelativeHtml(await capture('/privacidade')).replaceAll(`${site.seo.url}/privacidade"`, `${site.seo.url}/privacidade.html"`),
  );

  // Arquivos dinâmicos que viram arquivos fixos
  const robots = ['User-agent: *', 'Allow: /'];
  if (args.url) {
    robots.push(`Sitemap: ${site.seo.url}/sitemap.xml`);
    fs.writeFileSync(
      path.join(stageDir, 'sitemap.xml'),
      (await capture('/sitemap.xml')).replace(/\/privacidade</g, '/privacidade.html<'),
    );
  }
  fs.writeFileSync(path.join(stageDir, 'robots.txt'), `${robots.join('\n')}\n`);

  const manifest = JSON.parse(await capture('/site.webmanifest'));
  manifest.start_url = './';
  manifest.icons = manifest.icons.map((icon) => ({ ...icon, src: icon.src.replace(/^\//, '') }));
  fs.writeFileSync(path.join(stageDir, 'site.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`);

  // Visualização local (dois cliques no index.html): o navegador bloqueia
  // fontes vindas de arquivos locais. O main.js carrega esta cópia embutida
  // SÓ quando a página é aberta como arquivo; publicado, nunca é baixado.
  const fontFaces = [...fs.readFileSync(path.join(publicDir, 'css', 'tokens.css'), 'utf8').matchAll(/@font-face\s*{[^}]*}/g)]
    .map(([block]) =>
      block.replace(/url\((['"]?)\/fonts\/([^'")]+)\1\)/, (_m, _q, file) => {
        const data = fs.readFileSync(path.join(publicDir, 'fonts', file)).toString('base64');
        return `url(data:font/woff2;base64,${data})`;
      }),
    );
  fs.writeFileSync(
    path.join(stageDir, 'css', 'fonts-local.css'),
    `/* Só para ver o site abrindo o arquivo no computador (file://). Online, não é usado. */\n${fontFaces.join('\n')}\n`,
  );

  if (hasThemeOverrides(site.theme)) {
    fs.writeFileSync(path.join(stageDir, 'css', 'theme.css'), await capture('/css/theme.css'));
  }

  fs.writeFileSync(path.join(stageDir, '_headers'), netlifyHeaders);
  fs.writeFileSync(path.join(stageDir, '.htaccess'), htaccess);

  fs.writeFileSync(
    path.join(stageDir, 'LEIA-ME.txt'),
    [
      `${site.brand.name} · site sem banco de dados (versão estática)`,
      '='.repeat(60),
      '',
      'VER NO COMPUTADOR',
      '  Dê dois cliques em index.html.',
      '',
      'PUBLICAR',
      '  Envie TODO o conteúdo desta pasta (inclusive os arquivos ocultos',
      '  .htaccess e _headers) para a raiz do site na hospedagem:',
      '  • Hostinger, Locaweb, HostGator e similares: Gerenciador de Arquivos,',
      '    pasta public_html. O .htaccess ativa os cabeçalhos de segurança.',
      '  • Netlify ou Cloudflare Pages: arraste a pasta inteira para o painel.',
      '    O arquivo _headers ativa os cabeçalhos de segurança.',
      '',
      'COMO FUNCIONA',
      '  • iFood, WhatsApp, Instagram e "Como chegar" abrem direto nos apps.',
      '  • Pedido do cardápio e reserva viram uma mensagem pronta no WhatsApp',
      '    da casa. Não há banco de dados nem checagem de vagas nesta versão.',
      '  • "Aberto agora" e o dia de hoje nos horários são calculados no',
      '    navegador do visitante, no fuso da loja.',
      '',
      'ALTERAR TEXTOS, CORES, CONTATOS OU CARDÁPIO',
      '  Edite config/site.config.js e config/cardapio.config.js no projeto e',
      '  gere o site de novo (npm run build:static). Se você editar estes',
      '  arquivos à mão, o gerador avisa antes de sobrescrever.',
      '',
      args.url
        ? `ENDEREÇO PÚBLICO: ${site.seo.url}`
        : 'ATENÇÃO: gerado sem --url. Para a prévia do link no WhatsApp e o Google\n' +
          'funcionarem, gere de novo com --url=https://endereco-do-site.',
      '',
    ].join('\n'),
  );

  // Assinatura dos arquivos gerados: base da proteção contra sobrescrever edições manuais
  const hashes = Object.fromEntries(
    listFiles(stageDir).map((f) => [f, sha256(fs.readFileSync(path.join(stageDir, f)))]),
  );
  fs.writeFileSync(
    path.join(stageDir, MANIFEST),
    `${JSON.stringify({ aviso: 'Gerado por npm run build:static. Não precisa publicar este arquivo.', files: hashes }, null, 2)}\n`,
  );

  // Tudo certo: troca a pasta antiga pela nova.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.renameSync(stageDir, outDir);

  console.log(`\n✔ Site sem banco gerado em ${path.relative(process.cwd(), outDir) || outDir}`);
  console.log(`  • Cardápio: ${menuSource}`);
  console.log(`  • Endereço público: ${args.url ? site.seo.url : 'não definido (use --url=https://...)'}`);
  console.log(`  • Segurança: _headers (Netlify/Cloudflare) e .htaccess (Hostinger/cPanel)`);
  console.log(`  • Para ver: abra ${path.join(path.relative(process.cwd(), outDir) || outDir, 'index.html')} no navegador.\n`);
} finally {
  server.close();
  db.close();
}
