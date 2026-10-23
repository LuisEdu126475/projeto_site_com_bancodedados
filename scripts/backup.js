import fs from 'node:fs';
import path from 'node:path';
import env from '../src/config/env.js';
import { openDatabase } from '../src/db/index.js';

const backupsDir = path.resolve(process.cwd(), 'backups');
fs.mkdirSync(backupsDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const targetPath = path.join(backupsDir, `cafe-${stamp}.db`);
const escaped = targetPath.replace(/'/g, "''");

const db = openDatabase(env.DATABASE_PATH);
db.exec(`VACUUM INTO '${escaped}'`);
db.close();

console.log(`✔ Backup consistente gravado em: ${targetPath}`);

