/**
 * Utilitários de data/hora sempre relativos ao fuso horário da loja,
 * independentemente do fuso do servidor (essencial em hospedagens na nuvem).
 */

export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const WEEKDAY_LABELS = {
  sun: 'Domingo',
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
};
const DISPLAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Data (AAAA-MM-DD) e minutos desde a meia-noite no fuso informado. */
export function nowInZone(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Dia da semana ('mon'…'sun') de uma data de calendário, sem depender de fuso. */
export function weekdayOf(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Verifica se a string é uma data de calendário real (rejeita 2026-02-31). */
export function isValidIsoDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(fromIso, toIso) {
  const toUtc = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86_400_000);
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const fromMinutes = (total) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/** "08:00" → "8h", "08:30" → "8h30" */
export function prettyTime(hhmm) {
  const [h, m] = hhmm.split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
}

/** "2026-10-22" → "22/10/2026" */
export function formatDateBR(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Agrupa dias consecutivos com o mesmo horário para exibição:
 * [{ label: 'Terça a Quinta', hours: '8h – 19h' }, { label: 'Segunda', hours: 'Fechado' }]
 */
export function groupOpeningHours(hours) {
  const format = (intervals) =>
    intervals ? intervals.map(([o, c]) => `${prettyTime(o)} – ${prettyTime(c)}`).join(' e ') : 'Fechado';

  const groups = [];
  for (const day of DISPLAY_ORDER) {
    const text = format(hours[day]);
    const last = groups.at(-1);
    if (last && last.hours === text) last.days.push(day);
    else groups.push({ days: [day], hours: text, closed: !hours[day] });
  }
  return groups.map((g) => ({
    label:
      g.days.length === 1
        ? WEEKDAY_LABELS[g.days[0]]
        : `${WEEKDAY_LABELS[g.days[0]]} a ${WEEKDAY_LABELS[g.days.at(-1)]}`,
    hours: g.hours,
    closed: g.closed,
    days: g.days, // usado no navegador para destacar o dia de hoje
  }));
}

/**
 * Status "ao vivo" da loja: aberta agora? até quando? quando abre?
 * Retorna { open: boolean, label: string }.
 */
export function openingStatus(hours, timeZone, at = new Date()) {
  const { date, minutes } = nowInZone(timeZone, at);
  const today = weekdayOf(date);

  for (const [o, c] of hours[today] ?? []) {
    if (minutes >= toMinutes(o) && minutes < toMinutes(c)) {
      return { open: true, label: `Aberto agora, até ${prettyTime(c)}` };
    }
  }

  // Ainda abre hoje?
  const laterToday = (hours[today] ?? []).find(([o]) => toMinutes(o) > minutes);
  if (laterToday) return { open: false, label: `Fechado agora. Abre hoje às ${prettyTime(laterToday[0])}` };

  for (let i = 1; i <= 7; i++) {
    const next = weekdayOf(addDays(date, i));
    if (hours[next]?.length) {
      const when = i === 1 ? 'amanhã' : WEEKDAY_LABELS[next].toLowerCase();
      return { open: false, label: `Fechado agora. Abre ${when} às ${prettyTime(hours[next][0][0])}` };
    }
  }
  return { open: false, label: 'Fechado temporariamente' };
}

