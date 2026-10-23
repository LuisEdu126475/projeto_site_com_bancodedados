/**
 * Links dos canais da cafeteria (iFood, WhatsApp, Instagram, loja física e
 * loja online), montados uma vez a partir do config/site.config.js e usados
 * em todas as páginas. Canais opcionais que não foram configurados ficam
 * `null` e os botões correspondentes simplesmente não aparecem.
 */
export function buildLinks(site) {
  const wa = (text) => `https://wa.me/${site.contact.whatsapp}?text=${encodeURIComponent(text)}`;
  return {
    ifood: site.contact.ifood ?? null,
    instagram: site.contact.instagram ?? null,
    instagramHandle: site.contact.instagramHandle ?? null,
    onlineStore: site.contact.onlineStore ?? null,
    maps: site.contact.mapsUrl,
    whatsapp: wa(`Olá! Vim pelo site da ${site.brand.name}.`),
    whatsappOrder: wa(`Olá! Vim pelo site da ${site.brand.name} e quero fazer um pedido.`),
    whatsappGroups: wa(`Olá! Gostaria de consultar disponibilidade para um grupo na ${site.brand.name}.`),
  };
}

/**
 * Dados da loja entregues ao navegador num bloco JSON (não executável, então
 * compatível com a CSP): fuso, horários, regras de reserva e datas fechadas.
 * Com eles o navegador mostra "Aberto agora", destaca o horário de hoje e,
 * no site estático, calcula os horários de reserva sem servidor.
 */
export function buildStoreData(site, { closedDates = [] } = {}) {
  const r = site.reservations;
  return {
    timezone: site.timezone,
    hours: site.hours,
    closedDates,
    reservations: {
      enabled: r.enabled,
      slotMinutes: r.slotMinutes,
      lastSeatingBeforeCloseMinutes: r.lastSeatingBeforeCloseMinutes,
      minLeadMinutes: r.minLeadMinutes,
      maxAdvanceDays: r.maxAdvanceDays,
    },
  };
}

/**
 * O domínio público já foi definido (PUBLIC_URL ou --url)? Enquanto for
 * localhost, links canônicos, Open Graph e JSON-LD absolutos estariam errados.
 */
export const isPublicUrl = (url) => !/\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|\/|$)/.test(String(url));

/** JSON seguro para colocar dentro de <script type="application/json">. */
export const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
