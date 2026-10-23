/* ==========================================================================
   VITRINE DA CAFETERIA · status da loja, cardápio com pedido, reservas
   --------------------------------------------------------------------------
   Funciona nas duas versões:
   • com servidor: horários e reservas vêm da API (/api/...)
   • estática (<html data-static="true">): tudo é calculado aqui no navegador
     e a reserva/pedido segue pelo WhatsApp da casa
   ========================================================================== */

document.documentElement.classList.add('js');

// Site estático aberto com dois cliques (file://): o navegador bloqueia as
// fontes de arquivos locais, então carregamos a cópia embutida gerada pelo
// build. Na hospedagem (http/https) isto nunca acontece.
if (window.location.protocol === 'file:') {
  const fontsLink = document.createElement('link');
  fontsLink.rel = 'stylesheet';
  fontsLink.href = 'css/fonts-local.css';
  document.head.appendChild(fontsLink);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const IS_STATIC = document.documentElement.dataset.static === 'true';
const mainEl = document.getElementById('conteudo-principal');
const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Dados da casa (número do WhatsApp, nome) presos ao <main>. */
const shop = {
  get whatsapp() {
    return mainEl?.dataset.whatsapp || '';
  },
  get brand() {
    return mainEl?.dataset.brand || 'Cafeteria';
  },
  get address() {
    return mainEl?.dataset.address || '';
  },
};

const waLink = (text) => `https://wa.me/${shop.whatsapp}?text=${encodeURIComponent(text)}`;

// ---------------------------------------------------------------------------
//  Cabeçalho & menu do celular
// ---------------------------------------------------------------------------
const header = document.getElementById('site-header');
const drawer = document.getElementById('mobile-drawer');
const openBtn = document.getElementById('mobile-menu-open');
const closeBtn = document.getElementById('mobile-menu-close');

function syncHeader() {
  header?.classList.toggle('is-scrolled', window.scrollY > 24);
}
window.addEventListener('scroll', syncHeader, { passive: true });
syncHeader();

function setDrawer(open) {
  if (!drawer || !openBtn) return;
  drawer.classList.toggle('is-open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  openBtn.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) closeBtn?.focus();
  else openBtn.focus();
}

openBtn?.addEventListener('click', () => setDrawer(true));
closeBtn?.addEventListener('click', () => setDrawer(false));
drawer?.addEventListener('click', (e) => {
  if (e.target === drawer) setDrawer(false);
});
document.querySelectorAll('[data-drawer-link]').forEach((link) => {
  link.addEventListener('click', () => setDrawer(false));
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawer?.classList.contains('is-open')) setDrawer(false);
});

// ---------------------------------------------------------------------------
//  Datas e horários no fuso da loja (nunca no fuso do aparelho do visitante)
// ---------------------------------------------------------------------------
const store = (() => {
  try {
    return JSON.parse(document.getElementById('store-data')?.textContent || 'null');
  } catch {
    return null;
  }
})();

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_NAMES = {
  sun: 'domingo',
  mon: 'segunda',
  tue: 'terça',
  wed: 'quarta',
  thu: 'quinta',
  fri: 'sexta',
  sat: 'sábado',
};
const pad2 = (n) => String(n).padStart(2, '0');
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (t) => `${pad2(Math.floor(t / 60))}:${pad2(t % 60)}`;
const prettyTime = (hhmm) => {
  const [h, m] = hhmm.split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
};

function addDaysIso(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayKey(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Data (AAAA-MM-DD) e minutos do dia agora, no fuso da loja. */
function storeNow() {
  const now = new Date();
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: store?.timezone || undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
  } catch {
    return {
      date: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
      minutes: now.getHours() * 60 + now.getMinutes(),
    };
  }
}

/** Mesmo texto do servidor (src/utils/time.js → openingStatus). */
function openingStatus(hours) {
  const { date, minutes } = storeNow();
  const today = weekdayKey(date);
  for (const [o, c] of hours[today] ?? []) {
    if (minutes >= toMinutes(o) && minutes < toMinutes(c)) {
      return { open: true, label: `Aberto agora, até ${prettyTime(c)}` };
    }
  }
  const laterToday = (hours[today] ?? []).find(([o]) => toMinutes(o) > minutes);
  if (laterToday) return { open: false, label: `Fechado agora. Abre hoje às ${prettyTime(laterToday[0])}` };
  for (let i = 1; i <= 7; i++) {
    const next = weekdayKey(addDaysIso(date, i));
    if (hours[next]?.length) {
      const when = i === 1 ? 'amanhã' : WEEKDAY_NAMES[next];
      return { open: false, label: `Fechado agora. Abre ${when} às ${prettyTime(hours[next][0][0])}` };
    }
  }
  return { open: false, label: 'Fechado temporariamente' };
}

function refreshStoreStatus() {
  if (!store?.hours) return;
  const status = openingStatus(store.hours);
  document.querySelectorAll('[data-open-status]').forEach((el) => {
    el.textContent = status.label;
  });
  document.querySelectorAll('[data-open-dot]').forEach((el) => {
    el.classList.toggle('is-open', status.open);
  });
  const todayKey = weekdayKey(storeNow().date);
  document.querySelectorAll('[data-days]').forEach((row) => {
    row.classList.toggle('is-today', row.dataset.days.split(',').includes(todayKey));
  });
}
refreshStoreStatus();
setInterval(refreshStoreStatus, 60_000);

// ---------------------------------------------------------------------------
//  Modelos de cardápio (modo demonstração) & filtro por categoria
// ---------------------------------------------------------------------------
const CONCEPTS = {
  completo: {
    theme: null,
    descriptor: 'Specialty Coffee Roasters',
    eyebrow: 'Cafés especiais, torrefação e cozinha',
    titleLine1: 'O ritual do café,',
    titleLine2: 'elevado à arte.',
    lead: 'Microlotes de pontuação 86+ na escala SCA, brunch de fermentação natural e confeitaria laminada todos os dias.',
    categories: null,
  },
  torrefacao: {
    theme: 'noir',
    descriptor: 'Specialty Coffee Roasters',
    eyebrow: 'Microtorrefação de grãos 86+',
    titleLine1: 'Cada safra rara,',
    titleLine2: 'torrada no ponto.',
    lead: 'Lotes rastreáveis de produtores parceiros, extraídos sob medida em V60, Origami, Chemex e espresso.',
    categories: ['assinaturas', 'filtrados', 'espresso-bar', 'confeitaria'],
  },
  brunch: {
    theme: 'terra',
    descriptor: 'Café & All-Day Brunch',
    eyebrow: 'Cozinha da manhã e cafés especiais',
    titleLine1: 'Manhãs sem pressa,',
    titleLine2: 'mesa farta e café fresco.',
    lead: 'Pães de fermentação natural de 36h, ovos caipiras, queijos de produtores locais e cafés especiais.',
    categories: ['brunch-cozinha', 'espresso-bar', 'assinaturas', 'confeitaria'],
  },
  patisserie: {
    theme: 'creme',
    descriptor: 'Pâtisserie & Café',
    eyebrow: 'Confeitaria franco-brasileira',
    titleLine1: 'A delicadeza da pâtisserie,',
    titleLine2: 'em harmonia com o café.',
    lead: 'Viennoiserie laminada em 72h com manteiga francesa, entremets autorais e extrações calibradas na hora.',
    categories: ['patisserie-fina', 'confeitaria', 'espresso-bar', 'assinaturas'],
  },
};

let activeConcept = 'completo';
let activeCategory = 'all';

const conceptCards = document.querySelectorAll('[data-concept-select]');
const demoConceptBtns = document.querySelectorAll('[data-demo-concept]');
const menuTabs = document.querySelectorAll('[data-menu-filter]');
const menuBlocks = document.querySelectorAll('[data-category-slug]');

function applyMenuFilter() {
  const allowedSlugs = CONCEPTS[activeConcept]?.categories || null;

  menuTabs.forEach((tab) => {
    const slug = tab.getAttribute('data-menu-filter');
    tab.hidden = slug !== 'all' && Boolean(allowedSlugs && !allowedSlugs.includes(slug));
    const isSelected = slug === activeCategory;
    tab.classList.toggle('is-active', isSelected);
    tab.setAttribute('aria-pressed', String(isSelected));
  });

  menuBlocks.forEach((block) => {
    const slug = block.getAttribute('data-category-slug');
    const inConcept = !allowedSlugs || allowedSlugs.includes(slug);
    const matchesTab = activeCategory === 'all' || activeCategory === slug;
    block.hidden = !(inConcept && matchesTab);
  });
}

function setConcept(conceptKey, { updateHeroAndTheme = false } = {}) {
  if (!CONCEPTS[conceptKey]) return;
  activeConcept = conceptKey;
  activeCategory = 'all';

  conceptCards.forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-concept-select') === conceptKey);
  });
  demoConceptBtns.forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-demo-concept') === conceptKey);
  });

  if (updateHeroAndTheme) {
    const cfg = CONCEPTS[conceptKey];
    if (cfg.theme) setTheme(cfg.theme);
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    set('hero-eyebrow', cfg.eyebrow);
    set('hero-title-1', cfg.titleLine1);
    set('hero-title-2', cfg.titleLine2);
    set('hero-lead', cfg.lead);
    document.querySelectorAll('[data-descriptor-text]').forEach((el) => {
      el.textContent = cfg.descriptor;
    });
  }

  applyMenuFilter();
}

conceptCards.forEach((card) => {
  card.addEventListener('click', () => setConcept(card.getAttribute('data-concept-select')));
});

menuTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    activeCategory = tab.getAttribute('data-menu-filter') || 'all';
    applyMenuFilter();
  });
});

// ---------------------------------------------------------------------------
//  Pedido montado no cardápio (+ / bandeja / WhatsApp / reserva)
// ---------------------------------------------------------------------------
const selectedItems = new Map();
const selectionTray = document.getElementById('selection-tray');
const trayTitle = document.getElementById('tray-title');
const trayPreview = document.getElementById('tray-items-preview');
const trayWhatsappBtn = document.getElementById('tray-whatsapp-order-btn');
const selectedMenuBox = document.getElementById('selected-menu-box');
const selectedMenuSummary = document.getElementById('selected-menu-summary');
let reservationInView = false;

function getSelectionSummary() {
  let totalCount = 0;
  let totalCents = 0;
  const parts = [];
  for (const item of selectedItems.values()) {
    totalCount += item.qty;
    totalCents += item.qty * item.priceCents;
    parts.push(`${item.qty}x ${item.name}`);
  }
  return { totalCount, totalCents, parts, text: parts.join(', ') };
}

function syncMenuSelectionUI() {
  document.querySelectorAll('[data-menu-item]').forEach((card) => {
    const entry = selectedItems.get(card.getAttribute('data-item-id'));
    const pickBtn = card.querySelector('[data-pick-btn]');
    const stepper = card.querySelector('[data-item-stepper]');
    const qtyVal = card.querySelector('[data-qty-val]');
    const selected = Boolean(entry && entry.qty > 0);

    card.classList.toggle('is-selected', selected);
    if (pickBtn) pickBtn.hidden = selected;
    if (stepper) stepper.hidden = !selected;
    if (qtyVal && selected) qtyVal.textContent = String(entry.qty);
  });

  const { totalCount, totalCents, parts, text } = getSelectionSummary();
  if (totalCount === 0) {
    if (selectionTray) selectionTray.hidden = true;
    if (selectedMenuBox) selectedMenuBox.hidden = true;
    return;
  }

  const total = brl.format(totalCents / 100);
  if (trayTitle) trayTitle.textContent = `${totalCount} ${totalCount === 1 ? 'item' : 'itens'}, ${total}`;
  if (trayPreview) trayPreview.textContent = text;
  // A bandeja some enquanto o formulário de reserva está na tela (os itens já aparecem nele).
  if (selectionTray) selectionTray.hidden = reservationInView;

  if (selectedMenuBox && selectedMenuSummary) {
    selectedMenuSummary.textContent = `${text} (${total})`;
    selectedMenuBox.hidden = false;
  }

  if (trayWhatsappBtn) {
    const msg = [
      `Olá! Quero fazer este pedido na ${shop.brand}:`,
      '',
      ...parts.map((p) => `• ${p}`),
      '',
      `Total estimado: ${total}`,
      'Vou retirar no balcão ou combinamos a entrega?',
    ].join('\n');
    trayWhatsappBtn.href = waLink(msg);
  }
}

document.querySelectorAll('[data-menu-item]').forEach((card) => {
  const id = card.getAttribute('data-item-id');
  const name = card.getAttribute('data-item-name');
  const priceCents = Number(card.getAttribute('data-item-price') || 0);
  const pickBtn = card.querySelector('[data-pick-btn]');

  pickBtn?.addEventListener('click', () => {
    selectedItems.set(id, { id, name, priceCents, qty: 1 });
    syncMenuSelectionUI();
    card.querySelector('[data-qty-plus]')?.focus();
  });

  card.querySelector('[data-qty-plus]')?.addEventListener('click', () => {
    const curr = selectedItems.get(id)?.qty || 0;
    selectedItems.set(id, { id, name, priceCents, qty: Math.min(20, curr + 1) });
    syncMenuSelectionUI();
  });

  card.querySelector('[data-qty-minus]')?.addEventListener('click', () => {
    const curr = selectedItems.get(id)?.qty || 0;
    if (curr <= 1) {
      selectedItems.delete(id);
      syncMenuSelectionUI();
      pickBtn?.focus();
    } else {
      selectedItems.set(id, { id, name, priceCents, qty: curr - 1 });
      syncMenuSelectionUI();
    }
  });
});

function clearMenuSelection() {
  selectedItems.clear();
  syncMenuSelectionUI();
}

document.getElementById('tray-clear-btn')?.addEventListener('click', clearMenuSelection);
document.getElementById('clear-menu-selection-btn')?.addEventListener('click', clearMenuSelection);

const reservationSection = document.getElementById('reserva');
if (reservationSection && 'IntersectionObserver' in window) {
  new IntersectionObserver(
    ([entry]) => {
      reservationInView = entry.isIntersecting;
      syncMenuSelectionUI();
    },
    { threshold: 0.15 },
  ).observe(reservationSection);
}

// ---------------------------------------------------------------------------
//  Estúdio de demonstração comercial (só com DEMO_MODE=true)
// ---------------------------------------------------------------------------
const demoToggleBtn = document.getElementById('demo-toggle-btn');
const demoCloseBtn = document.getElementById('demo-close-btn');
const demoPanel = document.getElementById('demo-panel');
const demoBrandInput = document.getElementById('demo-brand-input');
const demoCityInput = document.getElementById('demo-city-input');
const demoThemeBtns = document.querySelectorAll('[data-demo-theme]');
const demoCopyBtn = document.getElementById('demo-copy-link-btn');

function setTheme(theme) {
  if (!['noir', 'terra', 'creme'].includes(theme)) return;
  document.documentElement.setAttribute('data-theme', theme);
  demoThemeBtns.forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-demo-theme') === theme);
  });
}

function setLiveBrand(name) {
  const cleanName = name.trim() || 'Croma';
  document.querySelectorAll('[data-brand-text]').forEach((el) => {
    el.textContent = cleanName;
  });
  if (mainEl) mainEl.dataset.brand = cleanName;
  document.title = `${cleanName} | Cafés especiais`;
  syncMenuSelectionUI();
}

function setLiveCity(city) {
  const cleanCity = city.trim() || 'Brasília/DF';
  document.querySelectorAll('[data-city-text]').forEach((el) => {
    el.textContent = cleanCity;
  });
}

demoToggleBtn?.addEventListener('click', () => {
  const isOpen = !demoPanel.hidden;
  demoPanel.hidden = isOpen;
  demoToggleBtn.setAttribute('aria-expanded', String(!isOpen));
});

demoCloseBtn?.addEventListener('click', () => {
  demoPanel.hidden = true;
  demoToggleBtn.setAttribute('aria-expanded', 'false');
});

demoBrandInput?.addEventListener('input', (e) => setLiveBrand(e.target.value));
demoCityInput?.addEventListener('input', (e) => setLiveCity(e.target.value));

demoConceptBtns.forEach((btn) => {
  btn.addEventListener('click', () => setConcept(btn.getAttribute('data-demo-concept'), { updateHeroAndTheme: true }));
});

demoThemeBtns.forEach((btn) => {
  btn.addEventListener('click', () => setTheme(btn.getAttribute('data-demo-theme')));
});

demoCopyBtn?.addEventListener('click', async () => {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  const brandVal = demoBrandInput?.value.trim();
  const cityVal = demoCityInput?.value.trim();
  if (brandVal) url.searchParams.set('cliente', brandVal);
  if (cityVal) url.searchParams.set('cidade', cityVal);
  if (activeConcept !== 'completo') url.searchParams.set('conceito', activeConcept);
  url.searchParams.set('tema', document.documentElement.getAttribute('data-theme') || 'noir');

  try {
    await navigator.clipboard.writeText(url.toString());
    const original = demoCopyBtn.textContent;
    demoCopyBtn.textContent = 'Link copiado. É só enviar ao cliente.';
    setTimeout(() => {
      demoCopyBtn.textContent = original;
    }, 2800);
  } catch {
    window.prompt('Copie o link personalizado abaixo:', url.toString());
  }
});

// Parâmetros de demonstração na URL (?cliente=...&cidade=...&conceito=...&tema=...)
(function applyUrlDemoParams() {
  // Só vale com DEMO_MODE=true (<html data-demo="true">): no site real do cliente é ignorado.
  if (document.documentElement.dataset.demo !== 'true') return;
  const params = new URLSearchParams(window.location.search);
  const conceito = params.get('conceito');
  const tema = params.get('tema');
  const cliente = params.get('cliente');
  const cidade = params.get('cidade');

  if (conceito && CONCEPTS[conceito]) setConcept(conceito, { updateHeroAndTheme: true });
  if (tema) setTheme(tema);
  if (cliente) {
    if (demoBrandInput) demoBrandInput.value = cliente;
    setLiveBrand(cliente);
  }
  if (cidade) {
    if (demoCityInput) demoCityInput.value = cidade;
    setLiveCity(cidade);
  }
})();

// ---------------------------------------------------------------------------
//  Reservas
// ---------------------------------------------------------------------------
const form = document.getElementById('reservation-form');
const dateInput = document.getElementById('cust-date');
const guestsSelect = document.getElementById('cust-guests');
const timeInput = document.getElementById('cust-time');
const slotsContainer = document.getElementById('slots-container');
const phoneInput = document.getElementById('cust-phone');
const submitBtn = document.getElementById('submit-btn');
const errorBox = document.getElementById('form-error-box');
const errorText = document.getElementById('form-error-text');
const formView = document.getElementById('booking-form-view');
const successView = document.getElementById('booking-success-view');

let currentSlots = [];
let lastReservation = null;

/** Máscara de celular brasileiro: (61) 99999-9999 (aceita colar com +55 na frente). */
function maskPhone(e) {
  let digits = e.target.value.replace(/\D/g, '');
  // Com DDI: mais de 11 dígitos começando por 55 → tira o código do país.
  // (Um DDD 55, do RS, tem no máximo 11 dígitos e não é afetado.)
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length <= 2) e.target.value = digits;
  else if (digits.length <= 6) e.target.value = `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  else if (digits.length <= 10) e.target.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  else e.target.value = `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}
phoneInput?.addEventListener('input', maskPhone);
document.getElementById('lookup-phone')?.addEventListener('input', maskPhone);

function showFormError(msg) {
  if (!errorBox || !errorText) return;
  errorText.textContent = msg || '';
  errorBox.hidden = !msg;
}

function placeholder(text) {
  slotsContainer.textContent = '';
  const el = document.createElement('div');
  el.className = 'slot-placeholder';
  el.textContent = text;
  slotsContainer.appendChild(el);
}

function selectSlot(time) {
  timeInput.value = time;
  slotsContainer.querySelectorAll('.slot-btn').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.time === time));
  });
}

function renderSlots() {
  if (!slotsContainer) return;
  const partySize = Number(guestsSelect?.value || 2);
  if (!currentSlots.length) {
    placeholder('Nenhum horário disponível nesta data. Escolha outro dia.');
    timeInput.value = '';
    return;
  }

  slotsContainer.textContent = '';
  let firstSelectable = null;
  for (const slot of currentSlots) {
    const canFit = slot.available && slot.remaining >= partySize;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot-btn';
    btn.dataset.time = slot.time;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.disabled = !canFit;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'slot-time';
    timeSpan.textContent = slot.time;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'slot-meta';
    if (IS_STATIC) metaSpan.textContent = 'Livre';
    else if (!slot.available) metaSpan.textContent = 'Esgotado';
    else if (!canFit) metaSpan.textContent = `${slot.remaining} vaga${slot.remaining === 1 ? '' : 's'}`;
    else if (slot.remaining <= 4) metaSpan.textContent = `Últimas ${slot.remaining}`;
    else metaSpan.textContent = 'Disponível';

    btn.append(timeSpan, metaSpan);
    btn.addEventListener('click', () => selectSlot(slot.time));
    slotsContainer.appendChild(btn);
    if (canFit && !firstSelectable) firstSelectable = slot.time;
  }

  if (firstSelectable) selectSlot(firstSelectable);
  else timeInput.value = '';
}

// --- Versão estática: horários calculados aqui, no fuso da loja -------------
function staticSlotsFor(dateIso) {
  const rules = store?.reservations ?? {};
  const hours = store?.hours ?? {};
  const closedDates = store?.closedDates ?? [];
  const slotMinutes = Number(rules.slotMinutes) || 30;
  const lastSeating = Number(rules.lastSeatingBeforeCloseMinutes) || 0;
  const minLead = Number(rules.minLeadMinutes) || 0;

  if (closedDates.includes(dateIso)) return { slots: [], reason: 'Não abriremos para reservas nesta data.' };
  const intervals = hours[weekdayKey(dateIso)];
  if (!intervals) return { slots: [], reason: 'Estamos fechados neste dia da semana. Escolha outra data.' };

  const now = storeNow();
  if (dateIso < now.date) return { slots: [], reason: 'Escolha hoje ou uma data futura.' };
  const earliest = dateIso === now.date ? now.minutes + minLead : 0;
  const slots = [];
  for (const [open, close] of intervals) {
    for (let t = toMinutes(open); t <= toMinutes(close) - lastSeating; t += slotMinutes) {
      if (t >= earliest) slots.push({ time: fromMinutes(t), available: true, remaining: 99 });
    }
  }
  return { slots, reason: 'Os horários de hoje já passaram. Escolha outra data.' };
}

function initStaticDateInput() {
  const maxAdvance = Number(store?.reservations?.maxAdvanceDays) || 30;
  const today = storeNow().date;
  dateInput.min = today;
  dateInput.max = addDaysIso(today, maxAdvance);
  let cursor = today;
  for (let i = 0; i <= maxAdvance; i++) {
    if (staticSlotsFor(cursor).slots.length) break;
    cursor = addDaysIso(cursor, 1);
  }
  dateInput.value = cursor;
}

async function loadAvailability() {
  if (!dateInput || !slotsContainer) return;
  const date = dateInput.value;
  if (!date) return;
  showFormError('');

  if (IS_STATIC) {
    const { slots, reason } = staticSlotsFor(date);
    currentSlots = slots;
    if (!slots.length) {
      placeholder(reason);
      timeInput.value = '';
    } else {
      renderSlots();
    }
    return;
  }

  placeholder('Consultando horários...');
  try {
    const res = await fetch(`/api/availability?date=${encodeURIComponent(date)}`, {
      headers: { Accept: 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Não foi possível carregar os horários.');

    if (!data.available) {
      currentSlots = [];
      placeholder(data.reason || 'Sem horários disponíveis nesta data.');
      timeInput.value = '';
      return;
    }
    currentSlots = data.slots || [];
    renderSlots();
  } catch (err) {
    placeholder(err.message || 'Não foi possível consultar os horários. Tente de novo.');
  }
}

dateInput?.addEventListener('change', loadAvailability);
guestsSelect?.addEventListener('change', renderSlots);

function formatBRDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const peopleLabel = (n) => (Number(n) === 1 ? '1 pessoa' : `${n} pessoas`);

/** Código para a mensagem da versão estática (mesmo alfabeto do servidor, sem 0/O/1/I/L). */
function localCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function selectedExperienceName() {
  const select = document.getElementById('cust-exp');
  return select?.selectedOptions[0]?.textContent.trim() || select?.value || '';
}

function submitViaWhatsApp(payload, userNotes, menuSummary) {
  const digits = payload.phone.replace(/\D/g, '');
  if (payload.name.length < 2) return showFormError('Informe seu nome.');
  if (digits.length < 10) return showFormError('Informe um WhatsApp válido, com DDD.');
  if (!payload.consent) return showFormError('Marque a concordância com a Política de Privacidade.');

  const code = localCode();
  const experience = selectedExperienceName();
  const lines = [
    `Olá! Quero reservar uma mesa na ${shop.brand}.`,
    '',
    `Código: #${code}`,
    `Nome: ${payload.name}`,
    `WhatsApp: ${payload.phone}`,
    `Data: ${formatBRDate(payload.date)} às ${payload.time}`,
    `Pessoas: ${payload.partySize}`,
    `Experiência: ${experience}`,
  ];
  if (payload.email) lines.push(`E-mail: ${payload.email}`);
  if (menuSummary.totalCount > 0) {
    lines.push(`Itens do cardápio: ${menuSummary.text} (${brl.format(menuSummary.totalCents / 100)})`);
  }
  if (userNotes) lines.push(`Observações: ${userNotes}`);

  const url = waLink(lines.join('\n'));
  window.open(url, '_blank', 'noopener');

  lastReservation = {
    code,
    name: payload.name,
    date: payload.date,
    time: payload.time,
    partySize: payload.partySize,
    experience,
    menuText: menuSummary.text,
  };
  clearMenuSelection();
  presentTicket(lastReservation, url);
  return undefined;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showFormError('');

  if (!timeInput.value) {
    showFormError('Escolha um horário disponível.');
    return;
  }

  const userNotes = document.getElementById('cust-notes').value.trim();
  const menuSummary = getSelectionSummary();
  const combinedNotes = [
    menuSummary.totalCount > 0 ? `Itens do cardápio: ${menuSummary.text} (${brl.format(menuSummary.totalCents / 100)})` : '',
    userNotes,
  ]
    .filter(Boolean)
    .join(' | ')
    .slice(0, 500);

  const payload = {
    date: dateInput.value,
    time: timeInput.value,
    partySize: Number(guestsSelect.value),
    experience: document.getElementById('cust-exp').value,
    name: document.getElementById('cust-name').value.trim(),
    phone: phoneInput.value,
    email: document.getElementById('cust-email').value.trim(),
    notes: combinedNotes,
    consent: document.getElementById('cust-consent').checked,
    website: document.getElementById('cust-website').value,
  };

  if (IS_STATIC) {
    submitViaWhatsApp(payload, userNotes, menuSummary);
    return;
  }

  submitBtn.disabled = true;
  const originalContent = [...submitBtn.childNodes];
  submitBtn.textContent = 'Registrando sua reserva...';

  try {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!res.ok) {
      if (res.status === 409) await loadAvailability();
      throw new Error(body?.error?.message || 'Não foi possível concluir a reserva.');
    }

    lastReservation = { ...body.reservation, menuText: menuSummary.text, phone: payload.phone };
    clearMenuSelection();
    presentTicket(lastReservation);
  } catch (err) {
    showFormError(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.replaceChildren(...originalContent);
  }
});

function presentTicket(r, staticWhatsappUrl) {
  document.getElementById('ticket-code').textContent = `#${r.code}`;
  document.getElementById('ticket-name').textContent = r.name;
  document.getElementById('ticket-datetime').textContent = `${formatBRDate(r.date)} às ${r.time}`;
  document.getElementById('ticket-guests').textContent = peopleLabel(r.partySize);
  document.getElementById('ticket-experience').textContent = r.menuText ? `${r.experience}, com ${r.menuText}` : r.experience;

  const ticketWa = document.getElementById('ticket-whatsapp-link');
  if (ticketWa) {
    if (staticWhatsappUrl) {
      ticketWa.href = staticWhatsappUrl; // reabre a mesma mensagem, caso não tenha sido enviada
    } else {
      const lines = [
        `Olá! Acabei de pedir uma reserva na ${shop.brand}.`,
        '',
        `Código: #${r.code}`,
        `Nome: ${r.name}`,
        `Data: ${formatBRDate(r.date)} às ${r.time}`,
        `Pessoas: ${r.partySize}`,
        `Experiência: ${r.experience}`,
      ];
      if (r.menuText) lines.push(`Itens do cardápio: ${r.menuText}`);
      ticketWa.href = waLink(lines.join('\n'));
    }
  }

  // Versão com banco: deixa a consulta/cancelamento já preenchida
  const lookupCode = document.getElementById('lookup-code');
  const lookupPhone = document.getElementById('lookup-phone');
  if (lookupCode && lookupPhone && !staticWhatsappUrl) {
    lookupCode.value = r.code;
    lookupPhone.value = r.phone || '';
  }

  formView.hidden = true;
  successView.hidden = false;
  successView.focus({ preventScroll: true });
  successView.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
}

document.getElementById('ticket-reset-btn')?.addEventListener('click', () => {
  form.reset();
  successView.hidden = true;
  formView.hidden = false;
  if (IS_STATIC) initStaticDateInput();
  loadAvailability();
  formView.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
});

// --- Lembrete na agenda (.ics, padrão RFC 5545) -----------------------------
const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Quebra linhas com mais de 75 octetos (UTF-8), sem cortar um caractere ao meio. */
const utf8 = new TextEncoder();
function icsFold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = utf8.encode(ch).length;
    const limit = out.length ? 74 : 75; // linhas de continuação começam com um espaço
    if (bytes + size > limit) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/**
 * Data/hora da reserva (no fuso da LOJA) convertida para UTC. Sem isso, a
 * agenda de quem estiver em outro fuso mostraria o horário errado.
 */
function storeTimeToUtc(dateIso, hhmm) {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  const wanted = Date.UTC(y, m - 1, d, h, min);
  let guess = wanted;
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: store?.timezone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    for (let i = 0; i < 2; i++) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, Number(x.value)]));
      guess += wanted - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    }
  } catch {
    guess = new Date(y, m - 1, d, h, min).getTime(); // sem suporte a fuso: usa o do aparelho
  }
  return new Date(guess);
}

const icsUtc = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

document.getElementById('ticket-ics-btn')?.addEventListener('click', () => {
  if (!lastReservation) return;
  const r = lastReservation;
  const start = storeTimeToUtc(r.date, r.time);
  const end = new Date(start.getTime() + 60 * 60_000);
  const host = window.location.hostname || 'reserva.local';

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cafeteria//Reservas//PT-BR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${r.code}@${host}`,
    `DTSTAMP:${icsUtc(new Date())}`,
    `DTSTART:${icsUtc(start)}`,
    `DTEND:${icsUtc(end)}`,
    `SUMMARY:${icsText(`Reserva ${shop.brand} (#${r.code})`)}`,
    `DESCRIPTION:${icsText(`${r.experience}, ${peopleLabel(r.partySize)}.${IS_STATIC ? ' Aguarde a confirmação da casa no WhatsApp.' : ''}`)}`,
    `LOCATION:${icsText(shop.address)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(icsFold)
    .join('\r\n');

  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `reserva-${r.code.toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

if (dateInput && IS_STATIC) initStaticDateInput();
if (dateInput) loadAvailability();

// ---------------------------------------------------------------------------
//  Consulta e cancelamento pelo cliente (versão com banco)
// ---------------------------------------------------------------------------
const STATUS_LABELS = {
  pending: 'Aguardando confirmação',
  confirmed: 'Confirmada',
  seated: 'Na mesa',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  no_show: 'Não compareceu',
};

const lookupForm = document.getElementById('lookup-form');
const lookupError = document.getElementById('lookup-error');
const lookupResult = document.getElementById('lookup-result');
const lookupCancelBtn = document.getElementById('lookup-cancel-btn');
const lookupNote = document.getElementById('lookup-res-note');
let lookupCredentials = null;
let cancelArmedTimer = null;

function showLookupError(msg) {
  if (!lookupError) return;
  lookupError.textContent = msg || '';
  lookupError.hidden = !msg;
}

function disarmCancel() {
  clearTimeout(cancelArmedTimer);
  if (lookupCancelBtn) {
    lookupCancelBtn.dataset.armed = '';
    lookupCancelBtn.textContent = 'Cancelar reserva';
  }
}

function renderLookup(r, note = '') {
  document.getElementById('lookup-res-code').textContent = `#${r.code}`;
  const badge = document.getElementById('lookup-res-status');
  badge.textContent = STATUS_LABELS[r.status] || r.status;
  badge.className = `status-badge status-${r.status}`;
  document.getElementById('lookup-res-when').textContent = `${formatBRDate(r.date)} às ${r.time}`;
  document.getElementById('lookup-res-detail').textContent = `${peopleLabel(r.partySize)}, ${r.experience}`;
  disarmCancel();
  lookupCancelBtn.hidden = !r.canCancel;
  lookupNote.textContent =
    note ||
    (r.status === 'cancelled'
      ? 'Esta reserva está cancelada.'
      : r.canCancel
        ? ''
        : 'Para mudar algo nesta reserva, fale com a gente pelo WhatsApp.');
  lookupResult.hidden = false;
}

async function lookupRequest(path) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(lookupCredentials),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || 'Não foi possível consultar a reserva.');
  return body.reservation;
}

lookupForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showLookupError('');
  lookupResult.hidden = true;
  lookupCredentials = {
    code: document.getElementById('lookup-code').value,
    phone: document.getElementById('lookup-phone').value,
  };
  const btn = document.getElementById('lookup-submit-btn');
  btn.disabled = true;
  try {
    renderLookup(await lookupRequest('/api/reservations/lookup'));
  } catch (err) {
    showLookupError(err.message);
  } finally {
    btn.disabled = false;
  }
});

lookupCancelBtn?.addEventListener('click', async () => {
  // Dois toques: o primeiro só pede confirmação.
  if (lookupCancelBtn.dataset.armed !== 'true') {
    lookupCancelBtn.dataset.armed = 'true';
    lookupCancelBtn.textContent = 'Confirmar cancelamento';
    lookupNote.textContent = 'Toque de novo para confirmar. A vaga será liberada para outra pessoa.';
    cancelArmedTimer = setTimeout(() => {
      disarmCancel();
      lookupNote.textContent = '';
    }, 6000);
    return;
  }
  disarmCancel();
  lookupCancelBtn.disabled = true;
  try {
    renderLookup(await lookupRequest('/api/reservations/cancel'), 'Reserva cancelada. Obrigado por avisar!');
  } catch (err) {
    showLookupError(err.message);
  } finally {
    lookupCancelBtn.disabled = false;
  }
});
