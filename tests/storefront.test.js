import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.NODE_ENV = 'test';

import { openDatabase, migrate } from '../src/db/index.js';
import { seedMenuIfEmpty } from '../src/db/seed-data.js';
import { createApp } from '../src/app.js';
import env from '../src/config/env.js';
import site from '../src/config/site.js';
import { instagramHandle } from '../src/config/site.js';
import { jsonForScript } from '../src/utils/channels.js';

const FIXED_NOW = new Date('2026-10-20T12:00:00.000Z'); // terça, 09:00 em Brasília

/** Asserções com mensagem curta: o HTML inteiro na falha trava o executor de testes. */
function mustMatch(text, re, msg = '') {
  if (!re.test(text)) throw new assert.AssertionError({ message: `não encontrado: ${re} ${msg}`.trim() });
}
function mustNotMatch(text, re, msg = '') {
  const m = text.match(re);
  if (m) {
    const i = m.index;
    throw new assert.AssertionError({ message: `não deveria existir: ${re} → …${text.slice(Math.max(0, i - 80), i + 80)}… ${msg}`.trim() });
  }
}

describe('Vitrine · canais (iFood, WhatsApp, Instagram, loja) e páginas', () => {
  let db;
  const makeApp = (opts = {}) => {
    db = openDatabase(':memory:');
    migrate(db);
    const app = createApp({ db, enableRateLimit: false, clock: () => FIXED_NOW, ...opts });
    seedMenuIfEmpty(db, app.locals.repos);
    return app;
  };
  const withContact = (contact) => ({ ...site, contact: { ...site.contact, ...contact } });

  afterEach(() => {
    try {
      db?.close();
    } catch {
      /* já fechado dentro do próprio teste */
    }
    db = null;
  });

  it('leva aos quatro canais com os links certos', async () => {
    const { text } = await request(makeApp()).get('/').expect(200);
    mustMatch(text, /Como você quer seu café hoje\?/);
    mustMatch(text, /href="https:\/\/www\.ifood\.com\.br\/"[^>]*>[\s\S]*?Pedir no iFood/);
    mustMatch(text, /href="https:\/\/wa\.me\/5561900000000\?text=Ol%C3%A1!%20Vim%20pelo%20site%20da%20Croma%20e%20quero%20fazer%20um%20pedido\."/);
    mustMatch(text, /href="https:\/\/instagram\.com\/croma\.cafe"/);
    mustMatch(text, /Seguir @croma\.cafe/);
    mustMatch(text, /href="https:\/\/maps\.google\.com\/\?q=SHCS\+CLS\+405\+Bloco\+C\+Brasilia"[^>]*>[\s\S]*?Como chegar/);
    // Barra fixa do celular com os 4 atalhos
    const bar = text.match(/<nav class="action-bar"[\s\S]*?<\/nav>/)[0];
    for (const label of ['iFood', 'WhatsApp', 'Instagram', 'Como chegar']) mustMatch(bar, new RegExp(`<span>${label}</span>`));
    // Links externos sempre com noopener
    for (const tag of text.match(/<a [^>]*target="_blank"[^>]*>/g)) mustMatch(tag, /rel="noopener( noreferrer)?"/);
  });

  it('sem iFood configurado os botões do iFood somem e o WhatsApp vira o principal', async () => {
    const { text } = await request(makeApp({ site: withContact({ ifood: undefined }) })).get('/').expect(200);
    mustNotMatch(text, /iFood/);
    mustMatch(text, /class="btn btn-primary btn-sm"[^>]*>Pedir pelo WhatsApp/);
  });

  it('sem Instagram a galeria vira "O ambiente"; com loja online aparece a linha da loja', async () => {
    const app = makeApp({ site: withContact({ instagram: undefined, instagramHandle: null, onlineStore: 'https://loja.exemplo.com.br' }) });
    const { text } = await request(app).get('/').expect(200);
    mustNotMatch(text, /instagram\.com/);
    mustMatch(text, /O ambiente/);
    mustMatch(text, /href="https:\/\/loja\.exemplo\.com\.br"[\s\S]*?Abrir a loja online/);
  });

  it('modelos de cardápio só aparecem no modo demonstração', async () => {
    const normal = await request(makeApp()).get('/').expect(200);
    mustNotMatch(normal.text, /menu-concept-bar|Modelo 01/);
    db.close();
    const demo = await request(makeApp({ env: { ...env, DEMO_MODE: true } })).get('/').expect(200);
    mustMatch(demo.text, /menu-concept-bar/);
  });

  it('com reservas desligadas não há formulário nem botões de reserva', async () => {
    const off = { ...site, reservations: { ...site.reservations, enabled: false } };
    const { text } = await request(makeApp({ site: off })).get('/').expect(200);
    mustNotMatch(text, /id="reserva"|Reservar mesa|tray-to-reservation-btn/);
  });

  it('respeita a CSP: sem style inline e sem script inline executável', async () => {
    const { text } = await request(makeApp()).get('/').expect(200);
    mustNotMatch(text, / style="/);
    const scripts = text.match(/<script[^>]*>/g);
    for (const tag of scripts) {
      mustMatch(tag, /type="application\/(ld\+)?json"|src="\/js\/main\.js"/, tag);
    }
    assert.equal(jsonForScript({ a: '</script><b>' }).includes('</script>'), false);
  });

  it('cardápio em lista com botão de adicionar acessível e horários com o dia marcado no navegador', async () => {
    const { text } = await request(makeApp()).get('/').expect(200);
    mustMatch(text, /aria-label="Adicionar Espresso Tonic Imperial ao pedido"/);
    mustMatch(text, /data-days="tue,wed,thu"/);
    mustMatch(text, /R\$\s26,00/);
  });

  it('dados estruturados (JSON-LD) ligam o site ao Instagram e ao iFood', async () => {
    const { text } = await request(makeApp()).get('/').expect(200);
    const ld = JSON.parse(text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
    assert.deepEqual(ld.sameAs, ['https://instagram.com/croma.cafe', 'https://www.ifood.com.br/']);
    assert.equal(ld['@type'], 'CafeOrCoffeeShop');
  });

  it('canonical e Open Graph só aparecem quando o domínio público é conhecido', async () => {
    const local = await request(makeApp()).get('/').expect(200);
    mustNotMatch(local.text, /rel="canonical"|og:url|localhost/);
    db.close();
    const prod = { ...site, seo: { ...site.seo, url: 'https://www.croma.cafe' } };
    const pub = await request(makeApp({ site: prod })).get('/').expect(200);
    mustMatch(pub.text, /<link rel="canonical" href="https:\/\/www\.croma\.cafe\/">/);
    mustMatch(pub.text, /<meta property="og:image" content="https:\/\/www\.croma\.cafe\/images\/hero\.jpg">/);
  });

  it('política de privacidade fala a verdade em cada versão', async () => {
    const server = await request(makeApp()).get('/privacidade').expect(200);
    mustMatch(server.text, /HMAC-SHA256/);
    mustMatch(server.text, /180 dias/);
    db.close();
    const stat = await request(makeApp({ staticBuild: true })).get('/privacidade').expect(200);
    mustMatch(stat.text, /não tem banco de dados/);
    mustNotMatch(stat.text, /HMAC|180 dias/);
  });

  it('página 404 mantém cabeçalho, canais e atalhos', async () => {
    const res = await request(makeApp()).get('/nao-existe').expect(404);
    mustMatch(res.text, /Página não encontrada/);
    mustMatch(res.text, /class="action-bar"/);
    mustMatch(res.text, /id="store-data"/);
  });

  it('extrai o @ do Instagram do link', () => {
    assert.equal(instagramHandle('https://www.instagram.com/croma.cafe/'), '@croma.cafe');
    assert.equal(instagramHandle('https://instagram.com/'), 'Instagram');
    assert.equal(instagramHandle(undefined), null);
  });
});
