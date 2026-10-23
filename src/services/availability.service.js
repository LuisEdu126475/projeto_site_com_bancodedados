import {
  addDays,
  diffDays,
  fromMinutes,
  isValidIsoDate,
  nowInZone,
  toMinutes,
  weekdayOf,
} from '../utils/time.js';

/**
 * Regras de disponibilidade: transforma o horário de funcionamento e a
 * capacidade configurada em horários reserváveis para uma data.
 */
export function createAvailabilityService({ site, repos, clock = () => new Date() }) {
  const rules = site.reservations;

  /** Motivo pelo qual a data não aceita reservas, ou null se aceita. */
  function dateBlockReason(date) {
    if (!isValidIsoDate(date)) return 'Data inválida.';
    const today = nowInZone(site.timezone, clock()).date;
    const ahead = diffDays(today, date);
    if (ahead < 0) return 'Não é possível reservar em datas passadas.';
    if (ahead > rules.maxAdvanceDays) return `Reservas abrem com até ${rules.maxAdvanceDays} dias de antecedência.`;
    if (rules.closedDates.includes(date) || repos.closedDates.has(date)) {
      return 'Não abriremos para reservas nesta data.';
    }
    if (!site.hours[weekdayOf(date)]) return 'Estamos fechados neste dia da semana.';
    return null;
  }

  /**
   * Datas fechadas de hoje em diante: as do arquivo de configuração (fixas) e
   * as bloqueadas pela equipe no painel. Usado no /admin e no site estático.
   */
  function closedDates() {
    const today = nowInZone(site.timezone, clock()).date;
    const byDate = new Map();
    for (const row of repos.closedDates.listFrom(today)) {
      byDate.set(row.date, { date: row.date, reason: row.reason, source: 'painel' });
    }
    // Datas do arquivo prevalecem: só saem editando o config/site.config.js.
    for (const date of rules.closedDates) {
      if (date >= today) byDate.set(date, { date, reason: byDate.get(date)?.reason ?? null, source: 'config' });
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Todos os horários teóricos de um dia (sem considerar ocupação). */
  function slotTimesFor(date) {
    const intervals = site.hours[weekdayOf(date)] ?? [];
    const out = [];
    for (const [open, close] of intervals) {
      const last = toMinutes(close) - rules.lastSeatingBeforeCloseMinutes;
      for (let m = toMinutes(open); m <= last; m += rules.slotMinutes) out.push(m);
    }
    return out;
  }

  /**
   * Horários de uma data com vagas restantes.
   * Retorna { date, available, reason?, slots: [{ time, remaining, available }] }
   */
  function forDate(date) {
    const reason = dateBlockReason(date);
    if (reason) return { date, available: false, reason, slots: [] };

    const now = nowInZone(site.timezone, clock());
    const isToday = date === now.date;
    const booked = new Map(repos.reservations.guestsBySlot(date).map((r) => [r.time, r.guests]));

    const slots = slotTimesFor(date)
      .filter((m) => !isToday || m >= now.minutes + rules.minLeadMinutes)
      .map((m) => {
        const time = fromMinutes(m);
        const remaining = Math.max(0, rules.capacityPerSlot - (booked.get(time) ?? 0));
        return { time, remaining, available: remaining > 0 };
      });

    const any = slots.some((s) => s.available);
    return {
      date,
      available: any,
      reason: any ? undefined : 'Não há mais horários disponíveis nesta data.',
      slots,
    };
  }

  /** Validação definitiva de um horário específico (usada dentro da transação). */
  function checkSlot(date, time, partySize) {
    const reason = dateBlockReason(date);
    if (reason) return { ok: false, reason };

    const minute = toMinutes(time);
    if (!slotTimesFor(date).includes(minute)) return { ok: false, reason: 'Horário indisponível para reservas.' };

    const now = nowInZone(site.timezone, clock());
    if (date === now.date && minute < now.minutes + rules.minLeadMinutes) {
      return { ok: false, reason: 'Este horário já não aceita reservas. Escolha um horário mais tarde.' };
    }

    const remaining = rules.capacityPerSlot - repos.reservations.guestsAt(date, time);
    if (partySize > remaining) {
      return {
        ok: false,
        reason:
          remaining > 0
            ? `Restam apenas ${remaining} lugar(es) neste horário.`
            : 'Este horário acabou de esgotar. Escolha outro, por favor.',
        conflict: true,
      };
    }
    return { ok: true };
  }

  /** Janela de datas reserváveis (para o atributo min/max do calendário). */
  function bookingWindow() {
    const today = nowInZone(site.timezone, clock()).date;
    return { min: today, max: addDays(today, rules.maxAdvanceDays) };
  }

  return { forDate, checkSlot, bookingWindow, dateBlockReason, closedDates };
}

