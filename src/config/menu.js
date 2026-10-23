import { z } from 'zod';
import menuConfig from '../../config/cardapio.config.js';

/**
 * Valida config/cardapio.config.js. Um preço digitado como texto ou um slug
 * com acento é apontado aqui, com o caminho exato do campo, em vez de virar
 * um erro confuso do banco de dados.
 */
const optionalText = (max) => z.string().trim().max(max).optional();

const itemSchema = z.object({
  name: z.string().trim().min(2).max(80),
  origin: optionalText(80),
  description: optionalText(400),
  tastingNotes: optionalText(120),
  volume: optionalText(20),
  price: z
    .number({ error: 'use um número com ponto decimal, ex.: 24.5' })
    .min(0)
    .max(10_000),
  isSignature: z.boolean().default(false),
});

const categorySchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'use letras minúsculas, números e hífen (sem acentos ou espaços)')
    .max(60),
  name: z.string().trim().min(2).max(60),
  description: optionalText(240),
  items: z.array(itemSchema).default([]),
});

const schema = z
  .array(categorySchema)
  .min(1, 'o cardápio precisa de pelo menos uma categoria')
  .refine((cats) => new Set(cats.map((c) => c.slug)).size === cats.length, 'há duas categorias com o mesmo slug');

/** Converte o formato amigável do arquivo para o formato do banco (centavos e posições). */
export function parseMenuConfig(raw) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  const menu = parsed.data.map((cat, ci) => ({
    slug: cat.slug,
    name: cat.name,
    description: cat.description,
    position: ci + 1,
    items: cat.items.map((item, ii) => ({
      name: item.name,
      origin: item.origin,
      description: item.description,
      tastingNotes: item.tastingNotes,
      volume: item.volume,
      priceCents: Math.round(item.price * 100),
      isSignature: item.isSignature,
      position: ii + 1,
    })),
  }));
  return { ok: true, menu };
}

/** "[2, 'items', 0, 'price']" → "categoria 3 › item 1 › price" (contagem humana, a partir de 1). */
export function describeMenuPath(path) {
  const parts = [];
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    if (typeof key === 'number') {
      parts.push(`${path[i - 1] === 'items' ? 'item' : 'categoria'} ${key + 1}`);
    } else if (key !== 'items') {
      parts.push(key);
    }
  }
  return parts.join(' › ') || '(arquivo)';
}

const result = parseMenuConfig(menuConfig);

if (!result.ok) {
  console.error('\n✖ config/cardapio.config.js contém erros:\n');
  for (const issue of result.issues) {
    console.error(`  • ${describeMenuPath(issue.path)}: ${issue.message}`);
  }
  console.error('');
  process.exit(1);
}

export default result.menu;
