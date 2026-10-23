import { z } from 'zod';
import siteConfig from '../../config/site.config.js';
import env from './env.js';

/**
 * Valida config/site.config.js na inicialização. Um erro de digitação em um
 * horário ou cor é detectado aqui, antes de chegar a um cliente.
 */
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use o formato HH:MM');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD');
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use cor hexadecimal #RRGGBB');
const interval = z
  .tuple([time, time])
  .refine(([open, close]) => open < close, 'a abertura precisa ser antes do fechamento');
const day = z.array(interval).min(1).nullable();
const imagePath = z.string().regex(/^\/[\w\-./]+$/, 'caminho deve começar com /');
// Links externos dos canais (iFood, Instagram, loja online): sempre completos e seguros.
const httpsUrl = z.url().refine((v) => v.startsWith('https://'), 'use o link completo, começando com https://');

const schema = z.object({
  brand: z.object({
    name: z.string().min(1).max(40),
    descriptor: z.string().max(60).default(''),
    legalName: z.string().min(1),
    cnpj: z.string().min(1),
    foundedYear: z.number().int().min(1900).max(2100),
  }),
  theme: z.object({
    preset: z.enum(['noir', 'terra', 'creme']).default('noir'),
    overrides: z
      .object({
        accent: hex.optional(),
        accentStrong: hex.optional(),
        background: hex.optional(),
        surface: hex.optional(),
        text: hex.optional(),
        textMuted: hex.optional(),
      })
      .default({}),
  }),
  seo: z.object({
    title: z.string().min(1).max(70),
    description: z.string().min(50).max(170),
    url: z.url(),
    ogImage: imagePath,
    locale: z.string().default('pt_BR'),
  }),
  contact: z.object({
    whatsapp: z.string().regex(/^\d{12,13}$/, 'somente dígitos com DDI, ex: 5561900000000'),
    phoneDisplay: z.string().min(1),
    email: z.email(),
    instagram: httpsUrl.optional(),
    // Página da loja no iFood (opcional). Sem ela, os botões do iFood não aparecem.
    ifood: httpsUrl.optional(),
    // Loja virtual de grãos/acessórios (opcional).
    onlineStore: httpsUrl.optional(),
    address: z.object({
      street: z.string().min(1),
      district: z.string().default(''),
      city: z.string().min(1),
      state: z.string().length(2),
      zip: z.string().default(''),
      country: z.string().length(2).default('BR'),
    }),
    mapsUrl: z.url(),
  }),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'fuso horário IANA inválido'),
  hours: z.object({ mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }),
  reservations: z.object({
    enabled: z.boolean().default(true),
    slotMinutes: z.number().int().min(10).max(240),
    capacityPerSlot: z.number().int().min(1).max(500),
    maxPartySize: z.number().int().min(1).max(50),
    minLeadMinutes: z.number().int().min(0).max(10080),
    maxAdvanceDays: z.number().int().min(1).max(365),
    lastSeatingBeforeCloseMinutes: z.number().int().min(0).max(600),
    closedDates: z.array(isoDate).default([]),
    experiences: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9-]{2,30}$/),
          name: z.string().min(2).max(60),
          description: z.string().max(200).default(''),
        }),
      )
      .min(1),
  }),
  content: z.object({
    hero: z.object({
      eyebrow: z.string(),
      titleLine1: z.string(),
      titleLine2: z.string(),
      lead: z.string(),
      image: imagePath.default('/images/hero.jpg'),
    }),
    marquee: z.array(z.string()).default([]),
    manifesto: z.object({
      eyebrow: z.string(),
      title: z.string(),
      paragraphs: z.array(z.string()).min(1),
      stats: z.array(z.object({ value: z.string(), label: z.string() })).max(4),
      image: imagePath.default('/images/ritual.jpg'),
      imageAlt: z.string().default('Barista finalizando um café com leite'),
    }),
    channels: z
      .object({ title: z.string().min(3).max(80) })
      .default({ title: 'Como você quer seu café hoje?' }),
    ritual: z.object({
      eyebrow: z.string(),
      title: z.string(),
      steps: z.array(z.object({ title: z.string(), image: imagePath, text: z.string() })).min(1).max(4),
    }),
    gallery: z.array(z.object({ src: imagePath, alt: z.string().min(3) })).max(8),
    testimonials: z
      .array(z.object({ quote: z.string(), author: z.string(), detail: z.string().default('') }))
      .max(6),
  }),
  legal: z.object({
    privacyPolicyVersion: isoDate,
    dpoEmail: z.email(),
    retentionDays: z.number().int().min(30).max(3650),
  }),
});

const parsed = schema.safeParse(siteConfig);

if (!parsed.success) {
  console.error('\n✖ config/site.config.js contém erros:\n');
  for (const issue of parsed.error.issues) {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  }
  console.error('');
  process.exit(1);
}

const site = parsed.data;

// A URL pública definida no ambiente tem prioridade sobre a do arquivo.
if (env.PUBLIC_URL) site.seo.url = env.PUBLIC_URL;
site.seo.url = site.seo.url.replace(/\/+$/, '');

site.contact.instagramHandle = instagramHandle(site.contact.instagram);

/** "https://instagram.com/croma.cafe/" → "@croma.cafe" (ou "Instagram" se o link for diferente). */
export function instagramHandle(url) {
  if (!url) return null;
  try {
    const first = new URL(url).pathname.split('/').filter(Boolean)[0];
    return first && /^[\w.]{1,30}$/.test(first) ? `@${first}` : 'Instagram';
  } catch {
    return 'Instagram';
  }
}

export default site;

