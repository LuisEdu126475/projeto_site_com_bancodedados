import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const envPath = path.resolve(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  const secret = crypto.randomBytes(48).toString('base64url');
  const content = [
    '# Configurações de Ambiente — Maison Café',
    'NODE_ENV=development',
    'HOST=0.0.0.0',
    'PORT=3000',
    'DATABASE_PATH=./data/cafe.db',
    'SESSION_TTL_HOURS=12',
    'TRUST_PROXY=0',
    'FORCE_HTTPS=false',
    '# Painel "Modo Demonstração" na vitrine (desligue no site real do cliente)',
    'DEMO_MODE=true',
    `IP_HASH_SECRET=${secret}`,
    'LOG_LEVEL=info',
    '',
  ].join('\n');
  fs.writeFileSync(envPath, content, 'utf8');
  console.log('✔ Arquivo .env gerado com segredo criptográfico exclusivo.');
}

const { default: env } = await import('../src/config/env.js');
const { openDatabase, migrate } = await import('../src/db/index.js');
const { createRepositories } = await import('../src/db/repositories.js');
const { seedMenuIfEmpty } = await import('../src/db/seed-data.js');
const { hashPassword } = await import('../src/utils/crypto.js');
const { DEMO_ADMIN_EMAIL, DEMO_ADMIN_PASSWORD } = await import('../src/config/demo.js');

const db = openDatabase(env.DATABASE_PATH);
const migrations = migrate(db);
const repos = createRepositories(db);
const menuResult = seedMenuIfEmpty(db, repos);

const defaultEmail = (process.env.ADMIN_EMAIL || DEMO_ADMIN_EMAIL).trim().toLowerCase();
const defaultPassword = process.env.ADMIN_PASSWORD || DEMO_ADMIN_PASSWORD;
const defaultName = process.env.ADMIN_NAME || 'Direção Croma';

const KNOWN_DEFAULT_PASSWORD = DEMO_ADMIN_PASSWORD;
let createdAdmin = false;
if (repos.users.count() === 0) {
  // A senha de demonstração é pública (está no README): nunca em produção.
  if (env.isProduction && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === KNOWN_DEFAULT_PASSWORD)) {
    console.error('\n✖ Em produção, defina ADMIN_PASSWORD com uma senha forte e exclusiva (e ADMIN_EMAIL).');
    console.error('  A senha padrão de demonstração não é permitida fora do ambiente de desenvolvimento.\n');
    db.close();
    process.exit(1);
  }
  const passwordHash = await hashPassword(defaultPassword);
  repos.users.create({
    email: defaultEmail,
    name: defaultName,
    passwordHash,
    role: 'owner',
  });
  createdAdmin = true;
}

db.close();

// Popula reservas demonstrativas
await import('./seed.js');

console.log('\n============================================================');
console.log('  AMBIENTE PRONTO · MAISON CAFÉ');
console.log('============================================================');
console.log(`  • Migrações aplicadas : ${migrations.length}`);
console.log(`  • Cardápio inicial    : ${menuResult.seeded ? 'criado' : 'já existente'}`);
if (createdAdmin) {
  console.log(`  • Login do Painel     : ${defaultEmail}`);
  console.log(`  • Senha inicial       : ${defaultPassword}`);
  console.log('    (Altere a senha no primeiro acesso em /admin → Minha Senha)');
}
console.log('\n  Inicie o servidor com: npm start');
console.log('============================================================\n');

