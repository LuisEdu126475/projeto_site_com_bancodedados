import env from '../src/config/env.js';
import { openDatabase, migrate } from '../src/db/index.js';

const db = openDatabase(env.DATABASE_PATH);
const applied = migrate(db);
db.close();

if (applied.length === 0) {
  console.log('✔ Banco de dados já está na última versão.');
} else {
  console.log(`✔ ${applied.length} migração(ões) aplicada(s): ${applied.join(', ')}`);
}

