import env from '../src/config/env.js';
import site from '../src/config/site.js';
import { openDatabase, migrate } from '../src/db/index.js';
import { createRepositories } from '../src/db/repositories.js';
import { seedMenuIfEmpty } from '../src/db/seed-data.js';
import { addDays, nowInZone, weekdayOf } from '../src/utils/time.js';

const db = openDatabase(env.DATABASE_PATH);
migrate(db);
const repos = createRepositories(db);

const menuResult = seedMenuIfEmpty(db, repos);
if (menuResult.seeded) {
  console.log(`✔ Cardápio populado (${menuResult.categories} categorias, ${menuResult.items} itens).`);
} else {
  console.log('• Cardápio já possuía dados; mantido sem alterações.');
}

// Cria reservas de demonstração caso a tabela esteja vazia
const existingReservations = repos.reservations.list({ limit: 1, offset: 0 }).total;
if (existingReservations === 0) {
  const today = nowInZone(site.timezone).date;
  const openDates = [];
  for (let i = 0; i < 14 && openDates.length < 3; i++) {
    const candidate = addDays(today, i);
    if (site.hours[weekdayOf(candidate)] && !site.reservations.closedDates.includes(candidate)) {
      openDates.push(candidate);
    }
  }

  const samples = [
    {
      code: 'CRM88A2F',
      name: 'Helena Vasconcelos',
      phone: '61998120011',
      email: 'helena@exemplo.com.br',
      partySize: 2,
      date: openDates[0],
      time: '15:00',
      experience: 'degustacao',
      notes: 'Gostaria de provar o Geisha no V60.',
    },
    {
      code: 'CRM47K9P',
      name: 'Gustavo Albuquerque',
      phone: '61997450022',
      email: 'gustavo@exemplo.com.br',
      partySize: 4,
      date: openDates[0],
      time: '16:30',
      experience: 'brunch',
      notes: 'Mesa próxima à janela, se possível.',
    },
    {
      code: 'CRM73M4D',
      name: 'Beatriz & Rodrigo',
      phone: '61996330044',
      email: 'beatriz@exemplo.com.br',
      partySize: 2,
      date: openDates[1] ?? openDates[0],
      time: '10:30',
      experience: 'espresso-bar',
      notes: 'Aniversário de casamento.',
    },
  ];

  for (const s of samples) {
    const id = repos.reservations.create({
      ...s,
      privacyVersion: site.legal.privacyPolicyVersion,
      ipHash: null,
    });
    if (s.code === 'CRM47K9P') {
      repos.reservations.update(id, { status: 'confirmed' });
    }
  }
  console.log(`✔ ${samples.length} reservas demonstrativas criadas.`);
}

db.close();

