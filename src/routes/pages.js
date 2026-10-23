import { Router } from 'express';
import { groupOpeningHours } from '../utils/time.js';
import { serializeMenu } from './menu.serializer.js';
import { accentColor, buildThemeCss, themeColor } from '../utils/theme.js';
import { isPublicUrl } from '../utils/channels.js';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatBRL = (cents) => brl.format((cents ?? 0) / 100);

export function pagesRouter({ site, repos, services }) {
  const router = Router();

  router.get('/', (_req, res) => {
    // O status "Aberto agora" (liveStatus) e os links dos canais chegam via
    // res.locals (src/app.js) porque aparecem em todas as páginas.
    res.render('pages/home', {
      menu: serializeMenu(repos, { publicOnly: true }),
      openingHours: groupOpeningHours(site.hours),
      bookingWindow: services.availability.bookingWindow(),
      jsonLd: buildJsonLd(site),
      formatBRL,
    });
  });

  router.get('/privacidade', (_req, res) => {
    res.render('pages/privacy', {
      title: `Política de Privacidade · ${site.brand.name}`,
    });
  });

  router.get('/admin', (_req, res) => {
    res
      .set('X-Robots-Tag', 'noindex, nofollow')
      .set('Cache-Control', 'no-store')
      .render('pages/admin', {
        title: `Painel · ${site.brand.name}`,
      });
  });

  // Cores da marca (theme.overrides). Servido como arquivo CSS por causa da CSP.
  router.get('/css/theme.css', (_req, res) => {
    res.type('text/css').set('Cache-Control', 'no-cache').send(buildThemeCss(site.theme));
  });

  router.get('/robots.txt', (_req, res) => {
    res
      .type('text/plain')
      .send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${site.seo.url}/sitemap.xml\n`);
  });

  router.get('/sitemap.xml', (_req, res) => {
    const urls = [`${site.seo.url}/`, `${site.seo.url}/privacidade`];
    const body = urls.map((u) => `  <url><loc>${escapeXml(u)}</loc></url>`).join('\n');
    res
      .type('application/xml')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
  });

  router.get('/site.webmanifest', (_req, res) => {
    res.type('application/manifest+json').json({
      name: `${site.brand.name} · ${site.brand.descriptor}`,
      short_name: site.brand.name,
      start_url: '/',
      display: 'standalone',
      background_color: themeColor(site.theme),
      theme_color: accentColor(site.theme),
      icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
    });
  });

  return router;
}

/** Dados estruturados Schema.org (CafeOrCoffeeShop) para rich snippets no Google. */
function buildJsonLd(site) {
  const dayMap = {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  };

  const openingHoursSpecification = [];
  for (const [key, intervals] of Object.entries(site.hours)) {
    if (!intervals) continue;
    for (const [opens, closes] of intervals) {
      openingHoursSpecification.push({
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: `https://schema.org/${dayMap[key]}`,
        opens,
        closes,
      });
    }
  }

  // Endereços absolutos só quando o domínio público é conhecido (nunca localhost).
  const urls = isPublicUrl(site.seo.url)
    ? { url: site.seo.url, image: `${site.seo.url}${site.seo.ogImage}`, hasMenu: `${site.seo.url}/#menu` }
    : {};

  return {
    '@context': 'https://schema.org',
    '@type': 'CafeOrCoffeeShop',
    name: site.brand.name,
    description: site.seo.description,
    ...urls,
    telephone: `+${site.contact.whatsapp}`,
    email: site.contact.email,
    servesCuisine: 'Specialty Coffee',
    priceRange: '$$',
    acceptsReservations: Boolean(site.reservations.enabled),
    hasMap: site.contact.mapsUrl,
    // Perfis oficiais da casa: ajudam o Google a ligar o site ao Instagram e ao iFood.
    ...(site.contact.instagram || site.contact.ifood
      ? { sameAs: [site.contact.instagram, site.contact.ifood].filter(Boolean) }
      : {}),
    address: {
      '@type': 'PostalAddress',
      streetAddress: site.contact.address.street,
      addressLocality: site.contact.address.city,
      addressRegion: site.contact.address.state,
      postalCode: site.contact.address.zip,
      addressCountry: site.contact.address.country,
    },
    openingHoursSpecification,
  };
}

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

