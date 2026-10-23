/* ==========================================================================
   PAINEL ADMINISTRATIVO · Reservas, Cardápio Digital, Auditoria & Conta
   ========================================================================== */

let csrfToken = '';
let currentUser = null;
let siteMeta = { name: 'Cafeteria', experiences: [] };
let currentPage = 1;
let totalPages = 1;
let menuState = [];

// Atualização automática do painel (novas reservas sem recarregar a página)
const POLL_INTERVAL_MS = 30_000;
const FRESH_HIGHLIGHT_MS = 2 * 60_000;
let pollTimer = null;
let pollBusy = false;
let lastLatestId = null;
let lastChangeToken = null;
let freshAfterId = 0;
let freshUntil = 0;
let unreadCount = 0;
const baseTitle = document.title;

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const toastEl = document.getElementById('toast');

const STATUS_LABELS = {
  pending: 'Pendente',
  confirmed: 'Confirmada',
  seated: 'Na mesa',
  completed: 'Concluída',
  cancelled: 'Cancelada',
  no_show: 'Não compareceu',
};

const STATUS_ACTIONS = {
  pending: [
    { to: 'confirmed', label: 'Confirmar' },
    { to: 'cancelled', label: 'Cancelar' },
  ],
  confirmed: [
    { to: 'seated', label: 'Sentar' },
    { to: 'no_show', label: 'Não veio' },
    { to: 'cancelled', label: 'Cancelar' },
  ],
  seated: [{ to: 'completed', label: 'Concluir' }],
  completed: [],
  cancelled: [{ to: 'pending', label: 'Reabrir' }],
  no_show: [{ to: 'confirmed', label: 'Reativar' }],
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function notify(message, { long = false } = {}) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(notify._timer);
  notify._timer = setTimeout(
    () => {
      toastEl.hidden = true;
    },
    long ? 9000 : 3600,
  );
}

// ---------------------------------------------------------------------------
//  Som de alerta (gerado pelo navegador, sem arquivo de áudio)
// ---------------------------------------------------------------------------
const SOUND_KEY = 'painel-som-alerta';
let audioCtx = null;
let soundOn = (() => {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
})();

function unlockAudio() {
  // Navegadores só liberam áudio depois de um clique: aproveitamos o primeiro.
  if (!soundOn) return;
  try {
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    /* navegador sem Web Audio: fica só o aviso visual */
  }
}

function playChime() {
  if (!soundOn) return;
  try {
    unlockAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    for (const [freq, offset] of [
      [880, 0],
      [1318.5, 0.18],
    ]) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.4);
    }
  } catch {
    /* sem áudio disponível */
  }
}

function syncSoundButton() {
  const btn = document.getElementById('sound-toggle-btn');
  if (!btn) return;
  btn.textContent = `Som de alerta: ${soundOn ? 'ligado' : 'desligado'}`;
  btn.setAttribute('aria-pressed', String(soundOn));
}

document.getElementById('sound-toggle-btn')?.addEventListener('click', () => {
  soundOn = !soundOn;
  try {
    localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off');
  } catch {
    /* preferência só vale nesta aba */
  }
  syncSoundButton();
  if (soundOn) playChime(); // prévia do som (e libera o áudio no navegador)
});
syncSoundButton();
document.addEventListener('pointerdown', unlockAudio, { once: true });

async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/admin/me' && path !== '/api/admin/login') {
      showLogin();
    }
    throw new Error(data?.error?.message || 'Falha na operação.');
  }
  return data;
}

function showLogin() {
  currentUser = null;
  csrfToken = '';
  stopPolling();
  dashboardView.hidden = true;
  loginView.hidden = false;
}

async function showDashboard(user, token, site) {
  currentUser = user;
  csrfToken = token;
  if (site) siteMeta = site;

  document.getElementById('admin-user-badge').textContent = `${user.name} (${user.role})`;
  const auditBtn = document.getElementById('audit-tab-btn');
  if (auditBtn) auditBtn.hidden = user.role !== 'owner';

  loginView.hidden = true;
  dashboardView.hidden = false;

  const [stats] = await Promise.all([loadStats(), loadReservations(), loadMenu(), loadClosures()]);
  lastLatestId = stats.latestId;
  lastChangeToken = stats.changeToken;
  startPolling();
}

// ---------------------------------------------------------------------------
//  Atualização automática: confere a cada 30 s se chegou reserva nova
// ---------------------------------------------------------------------------
function setLiveStatus(text, offline = false) {
  const el = document.getElementById('live-indicator');
  const label = document.getElementById('live-indicator-text');
  if (label) label.textContent = text;
  el?.classList.toggle('is-offline', offline);
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(pollForChanges, POLL_INTERVAL_MS);
  setLiveStatus('Atualização automática');
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function clearUnread() {
  unreadCount = 0;
  document.title = baseTitle;
}

function announceNewReservations(count) {
  notify(count === 1 ? 'Nova reserva recebida.' : `${count} novas reservas recebidas.`, { long: true });
  playChime();
  if (document.visibilityState !== 'visible' || !document.hasFocus()) {
    unreadCount += count;
    document.title = `(${unreadCount}) ${unreadCount === 1 ? 'Nova reserva' : 'Novas reservas'} · ${baseTitle}`;
  }
}

async function pollForChanges() {
  if (pollBusy || !currentUser) return;
  pollBusy = true;
  try {
    const s = await loadStats();
    const hasNew = lastLatestId !== null && s.latestId > lastLatestId;
    const changed = s.changeToken !== lastChangeToken;
    if (hasNew) {
      freshAfterId = lastLatestId;
      freshUntil = Date.now() + FRESH_HIGHLIGHT_MS;
      announceNewReservations(s.latestId - lastLatestId);
    }
    lastLatestId = s.latestId;
    lastChangeToken = s.changeToken;
    if (hasNew || changed) await loadReservations();
    const now = new Date();
    setLiveStatus(`Atualizado às ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  } catch {
    if (currentUser) setLiveStatus('Sem conexão: tentando de novo', true);
  } finally {
    pollBusy = false;
  }
}

window.addEventListener('focus', clearUnread);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    clearUnread();
    // Ao voltar para a aba, confere na hora em vez de esperar o próximo ciclo.
    if (currentUser) pollForChanges();
  }
});

// ---------------------------------------------------------------------------
//  Autenticação
// ---------------------------------------------------------------------------
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('login-error-box');
  const errText = document.getElementById('login-error-text');
  const btn = document.getElementById('login-submit-btn');
  errBox.hidden = true;
  btn.disabled = true;

  unlockAudio();

  try {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const data = await api('/api/admin/login', { method: 'POST', body: { email, password } });
    document.getElementById('login-password').value = '';
    const me = await api('/api/admin/me');
    await showDashboard(me.user, data.csrfToken, me.site);
  } catch (err) {
    errText.textContent = err.message;
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  try {
    await api('/api/admin/logout', { method: 'POST' });
  } finally {
    showLogin();
  }
});

// ---------------------------------------------------------------------------
//  Navegação por abas
// ---------------------------------------------------------------------------
document.querySelectorAll('[data-admin-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    const target = tab.getAttribute('data-admin-tab');
    document.querySelectorAll('[data-admin-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
    document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
      panel.hidden = panel.getAttribute('data-admin-panel') !== target;
    });
    if (target === 'audit') loadAudit();
    if (target === 'closures') loadClosures();
  });
});

// ---------------------------------------------------------------------------
//  Indicadores & Reservas
// ---------------------------------------------------------------------------
async function loadStats() {
  const s = await api('/api/admin/stats');
  document.getElementById('kpi-today-count').textContent = String(s.todayCount);
  document.getElementById('kpi-today-guests').textContent = String(s.todayGuests);
  document.getElementById('kpi-pending-count').textContent = String(s.pendingCount);
  document.getElementById('kpi-week-count').textContent = String(s.weekCount);
  document.getElementById('kpi-week-guests').textContent = String(s.weekGuests);
  const closureDate = document.getElementById('closure-date');
  if (closureDate) closureDate.min = s.today;
  return s;
}

function buildReservationQuery() {
  const params = new URLSearchParams();
  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;
  const status = document.getElementById('filter-status').value;
  const search = document.getElementById('filter-search').value.trim();

  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const exportLink = document.getElementById('export-csv-link');
  if (exportLink) {
    const q = params.toString();
    exportLink.href = `/api/admin/reservations/export.csv${q ? `?${q}` : ''}`;
  }

  params.set('page', String(currentPage));
  params.set('pageSize', '20');
  return params.toString();
}

function formatDateBR(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function experienceName(id) {
  return siteMeta.experiences?.find((e) => e.id === id)?.name || id;
}

async function loadReservations() {
  const tbody = document.getElementById('reservations-tbody');
  const query = buildReservationQuery();
  const { data, pagination } = await api(`/api/admin/reservations?${query}`);

  totalPages = pagination.pages;
  document.getElementById('reservations-summary').textContent = `${pagination.total} reserva(s)`;
  document.getElementById('page-indicator').textContent = `Página ${pagination.page} de ${pagination.pages}`;
  document.getElementById('page-prev-btn').disabled = pagination.page <= 1;
  document.getElementById('page-next-btn').disabled = pagination.page >= pagination.pages;

  tbody.textContent = '';
  if (!data.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.textContent = 'Nenhuma reserva encontrada para os filtros selecionados.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  const highlightNew = Date.now() < freshUntil;
  for (const r of data) {
    const tr = document.createElement('tr');
    if (highlightNew && r.id > freshAfterId) tr.classList.add('is-new');

    const tdCode = document.createElement('td');
    const codeStrong = document.createElement('strong');
    codeStrong.textContent = `#${r.code}`;
    tdCode.appendChild(codeStrong);

    const tdWhen = document.createElement('td');
    tdWhen.textContent = `${formatDateBR(r.date)} · ${r.time}`;

    const tdCustomer = document.createElement('td');
    const nameDiv = document.createElement('div');
    nameDiv.textContent = r.name;
    const subDiv = document.createElement('div');
    subDiv.className = 'kpi-sub';
    subDiv.textContent = r.phone + (r.notes ? ` · “${r.notes}”` : '');
    tdCustomer.append(nameDiv, subDiv);

    const tdParty = document.createElement('td');
    tdParty.textContent = `${r.partySize} pess.`;

    const tdExp = document.createElement('td');
    tdExp.textContent = experienceName(r.experience);

    const tdStatus = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `status-badge status-${r.status}`;
    badge.textContent = STATUS_LABELS[r.status] || r.status;
    tdStatus.appendChild(badge);

    const tdActions = document.createElement('td');
    const group = document.createElement('div');
    group.className = 'action-group';

    for (const act of STATUS_ACTIONS[r.status] || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-btn';
      btn.textContent = act.label;
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/admin/reservations/${r.id}`, {
            method: 'PATCH',
            body: { status: act.to },
          });
          notify(`Reserva #${r.code} atualizada para ${STATUS_LABELS[act.to]}.`);
          await Promise.all([loadStats(), loadReservations()]);
        } catch (err) {
          notify(err.message);
        }
      });
      group.appendChild(btn);
    }

    if (!r.anonymized && r.phone) {
      const wa = document.createElement('a');
      wa.className = 'chip-btn';
      wa.target = '_blank';
      wa.rel = 'noopener noreferrer';
      const phoneWithDdi = r.phone.length <= 11 ? `55${r.phone}` : r.phone;
      const msg = `Olá, ${r.name.split(' ')[0]}! Aqui é da ${siteMeta.name}. Sua reserva #${r.code} para ${formatDateBR(r.date)} às ${r.time} (${r.partySize} pessoa(s)) está confirmada. Esperamos por você!`;
      wa.href = `https://wa.me/${phoneWithDdi}?text=${encodeURIComponent(msg)}`;
      wa.textContent = 'WhatsApp';
      group.appendChild(wa);
    }

    tdActions.appendChild(group);
    tr.append(tdCode, tdWhen, tdCustomer, tdParty, tdExp, tdStatus, tdActions);
    tbody.appendChild(tr);
  }
}

document.getElementById('filter-apply-btn')?.addEventListener('click', () => {
  currentPage = 1;
  loadReservations();
});

document.getElementById('filter-clear-btn')?.addEventListener('click', () => {
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  document.getElementById('filter-status').value = '';
  document.getElementById('filter-search').value = '';
  currentPage = 1;
  loadReservations();
});

document.getElementById('page-prev-btn')?.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    loadReservations();
  }
});

document.getElementById('page-next-btn')?.addEventListener('click', () => {
  if (currentPage < totalPages) {
    currentPage++;
    loadReservations();
  }
});

// ---------------------------------------------------------------------------
//  Datas fechadas (feriados, eventos fechados, reformas)
// ---------------------------------------------------------------------------
function formatDateWithWeekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday.replace('.', '')}, ${formatDateBR(iso)}`;
}

async function loadClosures() {
  const tbody = document.getElementById('closures-tbody');
  if (!tbody) return;
  const { data } = await api('/api/admin/closed-dates');
  tbody.textContent = '';

  if (!data.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'Nenhuma data bloqueada. Use o formulário acima para fechar um dia.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const c of data) {
    const tr = document.createElement('tr');
    const tdDate = document.createElement('td');
    const strong = document.createElement('strong');
    strong.textContent = formatDateWithWeekday(c.date);
    tdDate.appendChild(strong);

    const tdReason = document.createElement('td');
    tdReason.textContent = c.reason || '—';

    const tdSource = document.createElement('td');
    tdSource.textContent = c.source === 'config' ? 'Arquivo de configuração' : 'Painel';

    const tdAct = document.createElement('td');
    if (c.source === 'painel') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-btn';
      btn.textContent = 'Liberar data';
      btn.addEventListener('click', async () => {
        if (!window.confirm(`Liberar ${formatDateBR(c.date)} para reservas?`)) return;
        try {
          await api(`/api/admin/closed-dates/${c.date}`, { method: 'DELETE' });
          notify(`${formatDateBR(c.date)} liberada para reservas.`);
          await loadClosures();
        } catch (err) {
          notify(err.message);
        }
      });
      tdAct.appendChild(btn);
    } else {
      tdAct.className = 'kpi-sub';
      tdAct.textContent = 'Fixa (editar no config)';
    }

    tr.append(tdDate, tdReason, tdSource, tdAct);
    tbody.appendChild(tr);
  }
}

document.getElementById('closure-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const dateInput = document.getElementById('closure-date');
  const reasonInput = document.getElementById('closure-reason');
  if (!dateInput.value) {
    notify('Escolha a data que ficará fechada.');
    return;
  }
  try {
    const res = await api('/api/admin/closed-dates', {
      method: 'POST',
      body: { date: dateInput.value, reason: reasonInput.value.trim() },
    });
    const when = formatDateBR(res.data.date);
    e.target.reset();
    notify(
      res.activeReservations > 0
        ? `${when} bloqueada. Atenção: já existem ${res.activeReservations} reserva(s) ativa(s) nesse dia. Avise os clientes.`
        : `${when} bloqueada. O site não oferece mais horários nesse dia.`,
      { long: res.activeReservations > 0 },
    );
    await loadClosures();
  } catch (err) {
    notify(err.message);
  }
});

// ---------------------------------------------------------------------------
//  Cardápio Digital (CRUD de Categorias & Itens)
// ---------------------------------------------------------------------------
const itemModal = document.getElementById('item-modal');
const categoryModal = document.getElementById('category-modal');

async function loadMenu() {
  const { data } = await api('/api/admin/menu');
  menuState = data;
  renderAdminMenu();
}

function renderAdminMenu() {
  const container = document.getElementById('admin-menu-container');
  const categorySelect = document.getElementById('item-category');
  container.textContent = '';
  categorySelect.textContent = '';

  for (const cat of menuState) {
    const opt = document.createElement('option');
    opt.value = String(cat.id);
    opt.textContent = cat.name;
    categorySelect.appendChild(opt);

    const block = document.createElement('div');
    block.className = 'menu-category-block';

    const header = document.createElement('div');
    header.className = 'menu-category-header';

    const titleWrap = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.className = 'menu-category-title';
    h3.textContent = `${cat.name} ${cat.isActive ? '' : '(Oculta)'}`;
    const p = document.createElement('p');
    p.className = 'menu-category-desc';
    p.textContent = cat.description || '';
    titleWrap.append(h3, p);

    const catActions = document.createElement('div');
    catActions.className = 'action-group';
    const editCatBtn = document.createElement('button');
    editCatBtn.type = 'button';
    editCatBtn.className = 'chip-btn';
    editCatBtn.textContent = 'Editar Categoria';
    editCatBtn.addEventListener('click', () => openCategoryModal(cat));
    catActions.appendChild(editCatBtn);

    header.append(titleWrap, catActions);
    block.appendChild(header);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrap';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML =
      '<thead><tr><th>Item</th><th>Origem / Notas</th><th>Preço</th><th>Status</th><th>Ações</th></tr></thead>';
    const tbody = document.createElement('tbody');

    for (const item of cat.items) {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      const strong = document.createElement('strong');
      strong.textContent = item.name;
      tdName.appendChild(strong);
      if (item.isSignature) {
        const sig = document.createElement('span');
        sig.className = 'badge-signature';
        sig.textContent = 'Assinatura';
        tdName.append(' ', sig);
      }

      const tdOrigin = document.createElement('td');
      tdOrigin.textContent = [item.origin, item.tastingNotes].filter(Boolean).join(' · ');

      const tdPrice = document.createElement('td');
      tdPrice.textContent = brl.format(item.priceCents / 100);

      const tdAvail = document.createElement('td');
      const statusBadge = document.createElement('span');
      statusBadge.className = `status-badge ${item.isAvailable ? 'status-confirmed' : 'status-cancelled'}`;
      statusBadge.textContent = item.isAvailable ? 'Disponível' : 'Pausado';
      tdAvail.appendChild(statusBadge);

      const tdAct = document.createElement('td');
      const actGroup = document.createElement('div');
      actGroup.className = 'action-group';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'chip-btn';
      editBtn.textContent = 'Editar';
      editBtn.addEventListener('click', () => openItemModal(item));

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'chip-btn';
      toggleBtn.textContent = item.isAvailable ? 'Pausar' : 'Ativar';
      toggleBtn.addEventListener('click', async () => {
        await api(`/api/admin/menu/items/${item.id}`, {
          method: 'PUT',
          body: { ...item, isAvailable: !item.isAvailable },
        });
        notify(`Item "${item.name}" atualizado.`);
        await loadMenu();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'chip-btn';
      delBtn.textContent = 'Excluir';
      delBtn.addEventListener('click', async () => {
        if (!window.confirm(`Excluir "${item.name}" do cardápio?`)) return;
        await api(`/api/admin/menu/items/${item.id}`, { method: 'DELETE' });
        notify('Item removido.');
        await loadMenu();
      });

      actGroup.append(editBtn, toggleBtn, delBtn);
      tdAct.appendChild(actGroup);

      tr.append(tdName, tdOrigin, tdPrice, tdAvail, tdAct);
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    block.appendChild(tableWrap);
    container.appendChild(block);
  }
}

function openItemModal(item = null) {
  document.getElementById('item-id').value = item ? String(item.id) : '';
  document.getElementById('item-category').value = item
    ? String(item.categoryId)
    : String(menuState[0]?.id || '');
  document.getElementById('item-name').value = item?.name || '';
  document.getElementById('item-origin').value = item?.origin || '';
  document.getElementById('item-volume').value = item?.volume || '';
  document.getElementById('item-notes').value = item?.tastingNotes || '';
  document.getElementById('item-desc').value = item?.description || '';
  document.getElementById('item-price').value = item ? (item.priceCents / 100).toFixed(2) : '';
  document.getElementById('item-signature').checked = Boolean(item?.isSignature);
  document.getElementById('item-available').checked = item ? Boolean(item.isAvailable) : true;
  itemModal.hidden = false;
}

function openCategoryModal(cat = null) {
  document.getElementById('cat-id').value = cat ? String(cat.id) : '';
  document.getElementById('cat-name').value = cat?.name || '';
  document.getElementById('cat-slug').value = cat?.slug || '';
  document.getElementById('cat-desc').value = cat?.description || '';
  document.getElementById('cat-pos').value = String(cat?.position ?? menuState.length + 1);
  document.getElementById('cat-active').checked = cat ? Boolean(cat.isActive) : true;
  categoryModal.hidden = false;
}

document.getElementById('new-item-btn')?.addEventListener('click', () => openItemModal());
document.getElementById('item-modal-cancel')?.addEventListener('click', () => {
  itemModal.hidden = true;
});
document.getElementById('new-category-btn')?.addEventListener('click', () => openCategoryModal());
document.getElementById('category-modal-cancel')?.addEventListener('click', () => {
  categoryModal.hidden = true;
});

document.getElementById('item-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('item-id').value;
  const payload = {
    categoryId: Number(document.getElementById('item-category').value),
    name: document.getElementById('item-name').value.trim(),
    origin: document.getElementById('item-origin').value.trim(),
    volume: document.getElementById('item-volume').value.trim(),
    tastingNotes: document.getElementById('item-notes').value.trim(),
    description: document.getElementById('item-desc').value.trim(),
    priceCents: Math.round(Number(document.getElementById('item-price').value) * 100),
    isSignature: document.getElementById('item-signature').checked,
    isAvailable: document.getElementById('item-available').checked,
    position: 1,
  };

  try {
    if (id) {
      await api(`/api/admin/menu/items/${id}`, { method: 'PUT', body: payload });
    } else {
      await api('/api/admin/menu/items', { method: 'POST', body: payload });
    }
    itemModal.hidden = true;
    notify('Cardápio salvo com sucesso.');
    await loadMenu();
  } catch (err) {
    notify(err.message);
  }
});

document.getElementById('category-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('cat-id').value;
  const payload = {
    name: document.getElementById('cat-name').value.trim(),
    slug: document.getElementById('cat-slug').value.trim().toLowerCase(),
    description: document.getElementById('cat-desc').value.trim(),
    position: Number(document.getElementById('cat-pos').value),
    isActive: document.getElementById('cat-active').checked,
  };

  try {
    if (id) {
      await api(`/api/admin/menu/categories/${id}`, { method: 'PUT', body: payload });
    } else {
      await api('/api/admin/menu/categories', { method: 'POST', body: payload });
    }
    categoryModal.hidden = true;
    notify('Categoria salva.');
    await loadMenu();
  } catch (err) {
    notify(err.message);
  }
});

// ---------------------------------------------------------------------------
//  Auditoria & Senha
// ---------------------------------------------------------------------------
async function loadAudit() {
  if (currentUser?.role !== 'owner') return;
  const tbody = document.getElementById('audit-tbody');
  const { data } = await api('/api/admin/audit');
  tbody.textContent = '';

  for (const row of data) {
    const tr = document.createElement('tr');
    const cells = [
      row.created_at,
      row.user_name || 'Sistema',
      row.action,
      `${row.entity}${row.entity_id ? ` #${row.entity_id}` : ''}`,
      row.details ? JSON.stringify(row.details) : '—',
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

document.getElementById('password-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('curr-pass').value;
  const newPassword = document.getElementById('new-pass').value;
  try {
    await api('/api/admin/account/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
    });
    e.target.reset();
    notify('Senha alterada com sucesso.');
  } catch (err) {
    notify(err.message);
  }
});

// Inicialização: verifica se já existe sessão ativa
(async () => {
  try {
    const me = await api('/api/admin/me');
    await showDashboard(me.user, me.csrfToken, me.site);
  } catch {
    showLogin();
  }
})();

