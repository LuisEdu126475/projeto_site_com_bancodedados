import { parseArgs } from 'node:util';
import env from '../src/config/env.js';
import { openDatabase, migrate } from '../src/db/index.js';
import { createRepositories } from '../src/db/repositories.js';
import { passwordPolicy } from '../src/schemas.js';
import { throttleAccount } from '../src/services/auth.service.js';
import { hashPassword } from '../src/utils/crypto.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string', short: 'e' },
    password: { type: 'string', short: 'p' },
    name: { type: 'string', short: 'n' },
    role: { type: 'string', short: 'r' },
  },
  strict: false,
});

const email = (values.email || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = values.password || process.env.ADMIN_PASSWORD || '';
const name = (values.name || process.env.ADMIN_NAME || 'Gestão da Casa').trim();
const role = values.role === 'manager' ? 'manager' : 'owner';

if (!email || !password) {
  console.error(
    'Uso: npm run admin:create -- --email=admin@croma.cafe --password="SuaSenhaForte123!" [--name="Nome"] [--role=owner|manager]',
  );
  process.exit(1);
}

const check = passwordPolicy.safeParse(password);
if (!check.success) {
  console.error(`✖ Senha inválida: ${check.error.issues[0].message}`);
  process.exit(1);
}

const db = openDatabase(env.DATABASE_PATH);
migrate(db);
const repos = createRepositories(db);

const passwordHash = await hashPassword(password);
const existing = repos.users.findByEmail(email);

if (existing) {
  repos.users.updatePassword(existing.id, passwordHash);
  repos.users.clearLock(existing.id);
  repos.loginThrottle.clearAccount(throttleAccount(email));
  repos.accountGuard.clear(throttleAccount(email));
  // Quem estava logado com a senha antiga é desconectado na hora (mesmo
  // comportamento da troca de senha pelo painel) e os aparelhos deixam de ser
  // "conhecidos": voltam a ser no próximo login com a senha nova.
  const { changes: closedSessions } = repos.sessions.deleteAllForUser(existing.id);
  repos.devices.revokeAllForUser(existing.id);
  repos.audit.log({
    userId: existing.id,
    action: 'auth.password_reset_cli',
    entity: 'admin_user',
    entityId: existing.id,
    details: { closedSessions },
  });
  console.log(`✔ Senha atualizada para ${email}: bloqueios limpos e ${closedSessions} sessão(ões) encerrada(s).`);
} else {
  repos.users.create({ email, name, passwordHash, role });
  console.log(`✔ Administrador criado: ${email} (${role}).`);
}

db.close();

