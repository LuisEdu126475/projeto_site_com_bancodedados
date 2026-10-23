import { transaction } from '../db/index.js';
import { conflict, notFound, unprocessable, HttpError } from '../utils/httpError.js';
import { reservationCode, safeEqual } from '../utils/crypto.js';
import { nowInZone, toMinutes } from '../utils/time.js';

/** Status que o próprio cliente ainda pode cancelar pelo site. */
const CUSTOMER_CANCELLABLE = ['pending', 'confirmed'];

/** WhatsApp sem o DDI 55 (o cliente pode digitar com ou sem ele). */
const nationalPhone = (digits) => (digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits);

/** Máquina de estados: quais transições de status são permitidas. */
const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['seated', 'cancelled', 'no_show', 'pending'],
  seated: ['completed'],
  completed: [],
  cancelled: ['pending'],
  no_show: ['confirmed'],
};

export function createReservationService({ db, site, repos, availability, clock = () => new Date() }) {
  /**
   * Cria uma reserva pública. A verificação de capacidade e a inserção ocorrem
   * na MESMA transação IMMEDIATE, o que impede overbooking mesmo com envios
   * simultâneos.
   */
  function create(input, { ipHash } = {}) {
    if (!site.reservations.enabled) {
      throw new HttpError(503, 'As reservas online estão temporariamente desativadas.', { code: 'DISABLED' });
    }
    if (!site.reservations.experiences.some((e) => e.id === input.experience)) {
      throw unprocessable('Experiência inválida.');
    }
    if (input.partySize > site.reservations.maxPartySize) {
      throw unprocessable(
        `Para grupos acima de ${site.reservations.maxPartySize} pessoas, fale conosco pelo WhatsApp.`,
      );
    }

    // Anti-abuso: no máximo 5 reservas por origem a cada hora.
    if (ipHash && repos.reservations.countRecentByIp(ipHash, 60) >= 5) {
      throw new HttpError(429, 'Muitas reservas em sequência. Tente novamente mais tarde.');
    }

    return transaction(db, () => {
      const check = availability.checkSlot(input.date, input.time, input.partySize);
      if (!check.ok) throw check.conflict ? conflict(check.reason) : unprocessable(check.reason);

      if (repos.reservations.hasActiveForPhone(input.phone, input.date)) {
        throw conflict('Já existe uma reserva ativa para este WhatsApp nesta data.');
      }

      let code;
      do code = reservationCode();
      while (repos.reservations.codeExists(code));

      const id = repos.reservations.create({
        ...input,
        code,
        privacyVersion: site.legal.privacyPolicyVersion,
        ipHash,
      });
      return repos.reservations.findById(id);
    });
  }

  function updateStatus(id, { status, internalNotes }, { userId, ipHash }) {
    return transaction(db, () => {
      const current = repos.reservations.findById(id);
      if (!current) throw notFound('Reserva não encontrada.');

      if (status && status !== current.status) {
        if (!TRANSITIONS[current.status].includes(status)) {
          throw unprocessable(`Não é possível mudar de "${current.status}" para "${status}".`);
        }
        // Reativar uma reserva exige que ainda haja vaga no horário.
        if (['cancelled', 'no_show'].includes(current.status)) {
          const remaining =
            site.reservations.capacityPerSlot -
            repos.reservations.guestsAt(current.reservation_date, current.reservation_time);
          if (remaining < current.party_size) throw conflict('Não há mais vagas neste horário para reativar.');
        }
      }

      repos.reservations.update(id, { status, internalNotes });
      repos.audit.log({
        userId,
        ipHash,
        action: status && status !== current.status ? `reservation.${status}` : 'reservation.notes',
        entity: 'reservation',
        entityId: id,
        details: { from: current.status, to: status ?? current.status },
      });
      return repos.reservations.findById(id);
    });
  }

  /**
   * Reserva do cliente pelo código + WhatsApp. Os dois precisam bater: só o
   * código (que pode aparecer num print compartilhado) não basta. A resposta
   * para "código errado" e "WhatsApp errado" é a mesma, para não dar pistas.
   */
  function findForCustomer(code, phone) {
    const r = repos.reservations.findByCode(code);
    const matches = r && !r.anonymized_at && safeEqual(nationalPhone(r.customer_phone), nationalPhone(phone));
    if (!matches) throw notFound('Não encontramos uma reserva com esse código e esse WhatsApp. Confira os dados.');
    return r;
  }

  /** O cliente pode cancelar enquanto a reserva estiver ativa e o horário não tiver passado. */
  function customerCanCancel(r) {
    if (!CUSTOMER_CANCELLABLE.includes(r.status)) return false;
    const now = nowInZone(site.timezone, clock());
    if (r.reservation_date !== now.date) return r.reservation_date > now.date;
    return toMinutes(r.reservation_time) > now.minutes;
  }

  function cancelByCustomer(code, phone, { ipHash } = {}) {
    return transaction(db, () => {
      const r = findForCustomer(code, phone);
      if (r.status === 'cancelled') return r;
      if (!customerCanCancel(r)) {
        throw unprocessable('Esta reserva não pode mais ser cancelada pelo site. Fale com a casa pelo WhatsApp.');
      }
      repos.reservations.update(r.id, { status: 'cancelled' });
      repos.audit.log({
        userId: null,
        ipHash,
        action: 'reservation.cancelled_by_customer',
        entity: 'reservation',
        entityId: r.id,
        details: { from: r.status, to: 'cancelled' },
      });
      return repos.reservations.findById(r.id);
    });
  }

  return { create, updateStatus, findForCustomer, customerCanCancel, cancelByCustomer, TRANSITIONS };
}

/** Representação pública/segura de uma reserva (sem dados internos). */
export function toPublicReservation(r, site) {
  const exp = site.reservations.experiences.find((e) => e.id === r.experience);
  return {
    code: r.code,
    name: r.customer_name,
    partySize: r.party_size,
    date: r.reservation_date,
    time: r.reservation_time,
    experience: exp?.name ?? r.experience,
    status: r.status,
  };
}

/** Representação para o painel administrativo. */
export function toAdminReservation(r) {
  return {
    id: r.id,
    code: r.code,
    name: r.customer_name,
    phone: r.customer_phone,
    email: r.customer_email,
    partySize: r.party_size,
    date: r.reservation_date,
    time: r.reservation_time,
    experience: r.experience,
    notes: r.notes,
    internalNotes: r.internal_notes,
    status: r.status,
    anonymized: Boolean(r.anonymized_at),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

