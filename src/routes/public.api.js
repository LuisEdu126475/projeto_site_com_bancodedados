import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { availabilityQuery, reservationInput, reservationLookupInput } from '../schemas.js';
import { toPublicReservation } from '../services/reservation.service.js';
import { hashIp, reservationCode } from '../utils/crypto.js';
import { serializeMenu } from './menu.serializer.js';

export function publicApiRouter({ db, site, repos, services, limiters }) {
  const router = Router();

  /** Verificação de saúde para orquestradores (Docker, Render, Railway, uptime monitors). */
  router.get('/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.set('Cache-Control', 'no-store').json({ status: 'ok', time: new Date().toISOString() });
  });

  router.get('/menu', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60').json(serializeMenu(repos, { publicOnly: true }));
  });

  router.get('/availability', validate({ query: availabilityQuery }), (req, res) => {
    res.set('Cache-Control', 'no-store').json(services.availability.forDate(req.valid.query.date));
  });

  router.post(
    '/reservations',
    limiters.reservations,
    validate({ body: reservationInput }),
    (req, res) => {
      const { website, consent: _consent, ...input } = req.valid.body;

      // Honeypot preenchido = robô. Responde como sucesso para não dar pistas,
      // mas nada é gravado.
      if (website) {
        return res.status(201).json({
          reservation: {
            code: reservationCode(),
            name: input.name,
            partySize: input.partySize,
            date: input.date,
            time: input.time,
            experience: input.experience,
            status: 'pending',
          },
        });
      }

      const created = services.reservations.create(input, { ipHash: hashIp(req.ip) });
      res.status(201).json({ reservation: toPublicReservation(created, site) });
    },
  );

  // Consulta e cancelamento pelo próprio cliente (código + WhatsApp).
  // POST (e não GET) para o telefone não aparecer em URLs nem em logs.
  router.post('/reservations/lookup', limiters.lookup, validate({ body: reservationLookupInput }), (req, res) => {
    const r = services.reservations.findForCustomer(req.valid.body.code, req.valid.body.phone);
    res.set('Cache-Control', 'no-store').json({
      reservation: { ...toPublicReservation(r, site), canCancel: services.reservations.customerCanCancel(r) },
    });
  });

  router.post('/reservations/cancel', limiters.lookup, validate({ body: reservationLookupInput }), (req, res) => {
    const r = services.reservations.cancelByCustomer(req.valid.body.code, req.valid.body.phone, {
      ipHash: hashIp(req.ip),
    });
    res.set('Cache-Control', 'no-store').json({ reservation: { ...toPublicReservation(r, site), canCancel: false } });
  });

  return router;
}

