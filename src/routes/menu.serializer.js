/** Converte linhas do banco em um cardápio agrupado por categoria. */
export function serializeMenu(repos, { publicOnly = false } = {}) {
  const categories = repos.menu.listCategories({ onlyActive: publicOnly });
  const items = repos.menu.listItems({ onlyAvailable: publicOnly });

  return categories.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    description: c.description,
    position: c.position,
    ...(publicOnly ? {} : { isActive: Boolean(c.is_active) }),
    items: items
      .filter((i) => i.category_id === c.id)
      .map((i) => ({
        id: i.id,
        categoryId: i.category_id,
        name: i.name,
        origin: i.origin,
        description: i.description,
        tastingNotes: i.tasting_notes,
        volume: i.volume,
        priceCents: i.price_cents,
        isSignature: Boolean(i.is_signature),
        position: i.position,
        ...(publicOnly ? {} : { isAvailable: Boolean(i.is_available) }),
      })),
  }));
}

