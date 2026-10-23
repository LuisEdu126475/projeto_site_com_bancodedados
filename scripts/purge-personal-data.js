import env from '../src/config/env.js';
import site from '../src/config/site.js';
import { openDatabase, migrate } from '../src/db/index.js';
import { createRepositories } from '../src/db/repositories.js';
import { addDays, nowInZone } from '../src/utils/time.js';

const db = openDatabase(env.DATABASE_PATH);
migrate(db);
const repos = createRepositories(db);

const today = nowInZone(site.timezone).date;
const cutoff = addDays(today, -site.legal.retentionDays);
const anonymized = repos.reservations.anonymizeOlderThan(cutoff);

if (anonymized > 0) {
  repos.audit.log({
    userId: null,
    action: 'lgpd.anonymize',
    entity: 'reservation',
    details: { cutoff, anonymized },
    ipHash: null,
  });
}

db.close();
console.log(
  `✔ Retenção LGPD executada (limite: reservas anteriores a ${cutoff}): ${anonymized} registro(s) anonimizado(s).`,
);

