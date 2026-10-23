import { z } from 'zod';

/**
 * Esquemas de validação de TODAS as entradas da API.
 * Campos desconhecidos são descartados (z.object padrão) e strings são
 * normalizadas (trim, espaços duplicados, caracteres de controle).
 */

// Remove caracteres de controle e normaliza espaços.
const clean = (s) =>
  s
    .normalize('NFC')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

const text = (min, max) => z.string().transform(clean).pipe(z.string().min(min).max(max));
const optionalText = (max) =>
  z
    .string()
    .transform(clean)
    .pipe(z.string().max(max))
    .transform((v) => (v === '' ? undefined : v))
    .optional()
    .nullable()
    .transform((v) => v ?? undefined);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.');
const id = z.coerce.number().int().positive();

// ---------------------------------------------------------------------------
//  Público
// ---------------------------------------------------------------------------
export const availabilityQuery = z.object({ date: isoDate });

export const reservationInput = z.object({
  name: text(2, 80).refine((v) => /^[\p{L}][\p{L}\s'.-]*$/u.test(v), 'Informe um nome válido.'),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().min(10, 'WhatsApp incompleto.').max(13, 'WhatsApp inválido.')),
  email: z
    .union([z.literal(''), z.email('E-mail inválido.').max(254)])
    .optional()
    .transform((v) => (v ? v.toLowerCase() : undefined)),
  partySize: z.coerce.number().int().min(1).max(50),
  date: isoDate,
  time: hhmm,
  experience: z.string().regex(/^[a-z0-9-]{2,30}$/),
  notes: optionalText(500),
  consent: z.literal(true, { error: 'É necessário aceitar a Política de Privacidade.' }),
  // Honeypot anti-spam: humanos não veem este campo.
  website: z.string().max(200).optional(),
});

/** Consulta/cancelamento pelo próprio cliente: código da reserva + WhatsApp usado nela. */
export const reservationLookupInput = z.object({
  code: z
    .string()
    .transform((v) => v.replace(/[#\s-]/g, '').toUpperCase())
    .pipe(z.string().regex(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/, 'Confira o código da reserva (8 letras e números).')),
  phone: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .pipe(z.string().min(10, 'Informe o WhatsApp usado na reserva, com DDD.').max(13, 'WhatsApp inválido.')),
});

// ---------------------------------------------------------------------------
//  Painel administrativo
// ---------------------------------------------------------------------------
export const loginInput = z.object({
  email: z.email('E-mail inválido.').max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(200),
});

// Política de senha: 12+ caracteres, com letras e números ou símbolos.
export const passwordPolicy = z
  .string()
  .min(12, 'A senha deve ter pelo menos 12 caracteres.')
  .max(200)
  .refine((v) => /[A-Za-zÀ-ÿ]/.test(v) && /[\d\W_]/.test(v), 'Use letras e também números ou símbolos.');

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordPolicy,
});

export const RESERVATION_STATUSES = ['pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'];

export const reservationListQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  status: z.enum(RESERVATION_STATUSES).optional(),
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

export const reservationUpdate = z
  .object({
    status: z.enum(RESERVATION_STATUSES).optional(),
    internalNotes: z
      .string()
      .transform(clean)
      .pipe(z.string().max(1000))
      .nullable()
      .optional()
      .transform((v) => (v === '' ? null : v)),
  })
  .refine((v) => v.status !== undefined || v.internalNotes !== undefined, 'Nada para atualizar.');

export const idParam = z.object({ id });

export const closedDateInput = z.object({
  date: isoDate,
  reason: optionalText(120),
});

export const closedDateParam = z.object({ date: isoDate });

export const categoryInput = z.object({
  name: text(2, 60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.')
    .max(60),
  description: optionalText(240),
  position: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});

export const menuItemInput = z.object({
  categoryId: id,
  name: text(2, 80),
  origin: optionalText(80),
  description: optionalText(400),
  tastingNotes: optionalText(120),
  volume: optionalText(20),
  priceCents: z.coerce.number().int().min(0).max(1_000_000),
  isSignature: z.boolean().default(false),
  isAvailable: z.boolean().default(true),
  position: z.coerce.number().int().min(0).max(9999).default(0),
});

