import { AMAZON_REGIONS, PROVIDERS, getProvider } from '../shared/providers.js';
import { formatTime, greeting } from './lib/format.js';
import { icons } from './lib/icons.js';
import { lunarPhase, moonSvg } from './lib/moon.js';
import { MoonProgress } from './lib/moon-progress.js';
import { PlayerHub } from './lib/player.js';
import { enabledIds, loadSettings, saveSettings } from './lib/settings.js';
import { startStarfield } from './lib/starfield.js';

const isDesktop = Boolean(window.moonify);
const api = window.moonify || {
  info: async () => ({ platform: 'web', widevine: false, widevineReady: false }),
  loginStatus: async () => ({}),
  logout: async () => true,
  openExternal: async (url) => window.open(url, '_blank', 'noopener'),
};

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
const hub = new PlayerHub();
/** @type {Map<string, {id: string, el: HTMLElement, frame: HTMLElement, overlay: HTMLElement, ready: boolean, loading: boolean, failed: string|null}>} */
const frames = new Map();
let info = { platform: 'web', widevine: false };
let loginStatus = {};
let view = { kind: 'home' };
let searchQuery = '';
let progress;

/* ---------- kleine DOM-Helfer ---------- */

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value; // nur für eigene, statische Icons
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

const providerOptions = () => ({ amazonRegion: settings.amazonRegion });
const connected = () => enabledIds(settings).map(getProvider);

function providerBadge(provider, size = '') {
  return h('span', { class: `provider-badge ${size}`, style: `--brand:${provider.color}` }, provider.name.charAt(0));
}

function statusLabel(provider) {
  if (!settings.enabled[provider.id]) return { text: 'Nicht verbunden', cls: 'off' };
  if (loginStatus[provider.id]) return { text: 'Angemeldet', cls: 'ok' };
  return { text: 'Bitte anmelden', cls: 'warn' };
}

/* ---------- Anbieter-Ansichten (eingebettete Web-Player) ---------- */

function ensureFrame(id) {
  if (frames.has(id)) return frames.get(id);
  const provider = getProvider(id);
  const webview = document.createElement('webview');
  webview.className = 'provider-webview';
  webview.setAttribute('partition', provider.partition);
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('src', provider.home(providerOptions()));

  const overlay = h('div', { class: 'frame-overlay' });
  const frame = h('div', { class: 'provider-frame', 'data-provider': id, style: `--brand:${provider.color}` }, webview, overlay);
  const entry = { id, el: webview, frame, overlay, ready: false, loading: true, failed: null };

  webview.addEventListener('ipc-message', (event) => {
    if (event.channel !== 'moonify:state') return;
    try {
      hub.update(id, JSON.parse(event.args[0]));
    } catch {
      // kaputte Nachricht ignorieren
    }
  });
  webview.addEventListener('dom-ready', () => {
    entry.ready = true;
    sendVolume(id);
    updateNavButtons();
  });
  webview.addEventListener('did-start-loading', () => {
    entry.loading = true;
    entry.failed = null;
    renderOverlay(entry);
  });
  webview.addEventListener('did-stop-loading', () => {
    entry.loading = false;
    renderOverlay(entry);
    updateNavButtons();
    scheduleLoginRefresh();
  });
  webview.addEventListener('did-navigate', updateNavButtons);
  webview.addEventListener('did-navigate-in-page', updateNavButtons);
  webview.addEventListener('did-fail-load', (event) => {
    // -3 = abgebrochen (z. B. durch eine Weiterleitung) – kein echter Fehler
    if (!event.isMainFrame || event.errorCode === -3) return;
    entry.failed = event.errorDescription || 'Seite konnte nicht geladen werden';
    renderOverlay(entry);
  });
  webview.addEventListener('render-process-gone', () => {
    entry.failed = 'Der Player ist abgestürzt';
    hub.remove(id);
    renderOverlay(entry);
  });

  $('webviews').append(frame);
  frames.set(id, entry);
  renderOverlay(entry);
  return entry;
}

function renderOverlay(entry) {
  const provider = getProvider(entry.id);
  const { overlay } = entry;
  overlay.replaceChildren();
  overlay.classList.toggle('visible', entry.loading || Boolean(entry.failed));
  if (entry.failed) {
    overlay.append(
      h('div', { class: 'overlay-card' },
        h('div', { class: 'overlay-moon', html: moonSvg({ lit: 0.25 }) }),
        h('h3', {}, `${provider.name} lädt nicht`),
        h('p', {}, entry.failed),
        h('button', { class: 'btn primary', onclick: () => reloadFrame(entry.id) }, 'Erneut versuchen')),
    );
  } else if (entry.loading && !entry.ready) {
    overlay.append(
      h('div', { class: 'overlay-card' },
        h('div', { class: 'overlay-moon spinning', html: moonSvg({ lit: 0.6 }) }),
        h('p', {}, `${provider.name} wird geladen …`)),
    );
  } else {
    overlay.classList.remove('visible');
  }
}

function reloadFrame(id) {
  const entry = frames.get(id);
  if (!entry) return;
  entry.failed = null;
  if (entry.ready) entry.el.reload();
  else entry.el.setAttribute('src', getProvider(id).home(providerOptions()));
}

function destroyFrame(id) {
  const entry = frames.get(id);
  if (!entry) return;
  entry.frame.remove();
  frames.delete(id);
  hub.remove(id);
}

function command(id, cmd) {
  const entry = frames.get(id);
  if (!entry?.ready) return;
  try {
    entry.el.send('moonify:command', cmd);
  } catch {
    // Ansicht noch nicht bereit
  }
}

function navigateFrame(id, url) {
  const entry = ensureFrame(id);
  if (!entry.ready) {
    entry.el.setAttribute('src', url);
  } else if (hub.isPlaying(id)) {
    // Läuft gerade Musik, nicht neu laden – sonst bricht der Song ab.
    command(id, { type: 'navigate', url });
  } else {
    entry.el.loadURL(url).catch(() => {});
  }
}

function effectiveVolume() {
  return settings.muted ? 0 : settings.volume;
}

function sendVolume(id) {
  command(id, { type: 'volume', volume: effectiveVolume() });
}

hub.addEventListener('pause-others', (event) => {
  for (const id of event.detail.ids) command(id, { type: 'pause' });
});

/* ---------- Navigation ---------- */

function showView(next) {
  if (next.kind === 'provider' && !settings.enabled[next.id]) next = { kind: 'home' };
  view = next;
  $('view-home').classList.toggle('active', view.kind === 'home');
  $('view-providers').classList.toggle('active', view.kind === 'providers');
  $('provider-stage').classList.toggle('active', view.kind === 'provider');
  if (view.kind === 'provider') ensureFrame(view.id);
  for (const [id, entry] of frames) entry.frame.classList.toggle('active', view.kind === 'provider' && view.id === id);
  if (view.kind === 'home') renderHome();
  if (view.kind === 'providers') renderProviders();
  renderSidebar();
  renderSearchStrip();
  updateNavButtons();
}

function activeFrame() {
  return view.kind === 'provider' ? frames.get(view.id) : null;
}

function updateNavButtons() {
  const entry = activeFrame();
  const ready = Boolean(entry?.ready);
  $('nav-back').disabled = !ready || !safe(() => entry.el.canGoBack());
  $('nav-forward').disabled = !ready || !safe(() => entry.el.canGoForward());
  $('nav-reload').disabled = !entry;
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return false;
  }
}

/* ---------- Anbieter verbinden / trennen ---------- */

function connectProvider(id) {
  settings.enabled[id] = true;
  saveSettings(settings);
  ensureFrame(id);
  renderAll();
  showView({ kind: 'provider', id });
}

function disconnectProvider(id) {
  const provider = getProvider(id);
  openModal({
    title: `${provider.name} trennen?`,
    text: 'Beim Ausblenden bleibst du angemeldet und kannst den Dienst später sofort wieder verbinden. Beim Abmelden werden alle Login-Daten dieses Anbieters aus Moonify gelöscht.',
    actions: [
      { label: 'Abbrechen' },
      { label: 'Nur ausblenden', run: () => removeProvider(id, false) },
      { label: 'Abmelden & trennen', danger: true, run: () => removeProvider(id, true) },
    ],
  });
}

async function removeProvider(id, logout) {
  settings.enabled[id] = false;
  saveSettings(settings);
  destroyFrame(id);
  if (logout) await api.logout(id);
  await refreshLoginStatus();
  if (view.kind === 'provider' && view.id === id) showView({ kind: 'home' });
  renderAll();
}

function setAmazonRegion(region) {
  if (!Object.hasOwn(AMAZON_REGIONS, region)) return;
  settings.amazonRegion = region;
  saveSettings(settings);
  if (frames.has('amazon')) navigateFrame('amazon', getProvider('amazon').home(providerOptions()));
}

/* ---------- Suche ---------- */

function runSearch(query) {
  const q = query.trim();
  if (!q) return;
  const list = connected();
  if (!list.length) {
    showView({ kind: 'providers' });
    return;
  }
  searchQuery = q;
  for (const provider of list) navigateFrame(provider.id, provider.search(q, providerOptions()));
  const target = view.kind === 'provider' && settings.enabled[view.id] ? view.id : list[0].id;
  showView({ kind: 'provider', id: target });
}

function clearSearch() {
  searchQuery = '';
  $('search-input').value = '';
  renderSearchStrip();
}

function renderSearchStrip() {
  const strip = $('search-strip');
  const show = Boolean(searchQuery) && view.kind === 'provider';
  strip.hidden = !show;
  $('provider-stage').classList.toggle('with-strip', show);
  if (!show) return;
  strip.replaceChildren(
    h('span', { class: 'strip-label' }, 'Ergebnisse für ', h('strong', {}, `„${searchQuery}“`), ' in'),
    h('div', { class: 'strip-tabs', role: 'tablist' },
      connected().map((p) =>
        h('button', {
          class: `strip-tab${view.id === p.id ? ' active' : ''}`,
          role: 'tab',
          'aria-selected': String(view.id === p.id),
          style: `--brand:${p.color}`,
          onclick: () => showView({ kind: 'provider', id: p.id }),
        }, h('span', { class: 'dot' }), p.short))),
    h('button', { class: 'icon-btn strip-close', title: 'Suche schließen', 'aria-label': 'Suche schließen', html: icons.close, onclick: clearSearch }),
  );
}

function updateSearchPlaceholder() {
  const list = connected();
  const input = $('search-input');
  input.disabled = !list.length;
  input.placeholder = list.length
    ? `Suchen in ${list.map((p) => p.short).join(', ').replace(/, ([^,]*)$/, ' & $1')} …`
    : 'Verbinde zuerst einen Anbieter';
}

/* ---------- Seitenleiste ---------- */

function renderSidebar() {
  $('nav-home').classList.toggle('active', view.kind === 'home');
  $('nav-manage').classList.toggle('active', view.kind === 'providers');
  const list = connected();
  $('nav-empty').hidden = list.length > 0;
  const current = hub.current();
  $('nav-providers').replaceChildren(
    ...list.map((p) => {
      const status = statusLabel(p);
      const playing = current?.id === p.id && current.playing;
      return h('button', {
        class: `nav-item provider${view.kind === 'provider' && view.id === p.id ? ' active' : ''}`,
        style: `--brand:${p.color}`,
        onclick: () => showView({ kind: 'provider', id: p.id }),
        title: `${p.name} – ${status.text}`,
      },
      providerBadge(p, 'small'),
      h('span', { class: 'nav-label' }, p.name),
      playing
        ? h('span', { class: 'eq', 'aria-label': 'spielt gerade' }, h('i'), h('i'), h('i'))
        : h('span', { class: `status-dot ${status.cls}`, 'aria-label': status.text }));
    }),
  );
}

function renderTonight() {
  const phase = lunarPhase();
  $('tonight').replaceChildren(
    h('span', { class: 'tonight-moon', html: moonSvg({ lit: phase.lit, waxing: phase.waxing, glow: false }) }),
    h('span', { class: 'tonight-text' },
      h('small', {}, 'Heute am Himmel'),
      h('span', {}, `${phase.name} · ${Math.round(phase.lit * 100)} %`)),
  );
}

/* ---------- Startseite ---------- */

function renderHome() {
  const root = $('view-home');
  const list = connected();
  const phase = lunarPhase();
  const hero = h('div', { class: 'hero' },
    h('div', { class: 'hero-text' },
      h('p', { class: 'eyebrow', html: `${icons.sparkle}<span></span>` }),
      h('h1', {}, greeting()),
      h('p', { class: 'hero-sub' }, list.length
        ? 'All deine Musik unter einem Himmel.'
        : 'Willkommen bei Moonify – verbinde deine Musikdienste und hör alles an einem Ort.')),
    h('div', { class: 'hero-moon', id: 'hero-moon', html: moonSvg({ lit: phase.lit, waxing: phase.waxing, className: 'big' }) }));
  hero.querySelector('.eyebrow span').textContent = `${phase.name} · ${Math.round(phase.lit * 100)} % beleuchtet`;

  const nowCard = h('div', { class: 'now-card', id: 'home-now', hidden: true },
    h('div', { class: 'now-card-art', id: 'home-now-art' }),
    h('div', { class: 'now-card-text' },
      h('small', { id: 'home-now-label' }, 'Jetzt läuft'),
      h('div', { class: 'now-card-title', id: 'home-now-title' }),
      h('div', { class: 'now-card-artist', id: 'home-now-artist' })),
    h('button', { class: 'btn ghost', id: 'home-now-open', html: `${icons.open}<span>Öffnen</span>` }));

  const sections = [hero, nowCard];

  if (list.length) {
    const missing = PROVIDERS.filter((p) => !settings.enabled[p.id]);
    sections.push(
      h('h2', { class: 'section-title' }, 'Deine Anbieter'),
      h('div', { class: 'provider-grid' },
        list.map((p) => {
          const status = statusLabel(p);
          return h('button', { class: 'provider-card', style: `--brand:${p.color}`, onclick: () => showView({ kind: 'provider', id: p.id }) },
            h('div', { class: 'card-glow' }),
            providerBadge(p, 'large'),
            h('div', { class: 'card-name' }, p.name),
            h('div', { class: `pill ${status.cls}` }, status.text),
            h('div', { class: 'card-cta', html: `<span>Öffnen</span>${icons.forward}` }));
        }),
        missing.length
          ? h('button', { class: 'provider-card add', onclick: () => showView({ kind: 'providers' }) },
            h('span', { class: 'add-icon', html: icons.plus }),
            h('div', { class: 'card-name' }, 'Weiteren Anbieter verbinden'),
            h('div', { class: 'card-hint' }, missing.map((p) => p.short).join(' · ')))
          : null),
    );
  } else {
    sections.push(
      h('h2', { class: 'section-title' }, 'Womit hörst du Musik?'),
      h('p', { class: 'section-sub' }, 'Wähle einen oder mehrere Dienste. Keiner ist Pflicht – Moonify zeigt dir nur Musik von den Anbietern, mit denen du dich anmeldest.'),
      h('div', { class: 'provider-grid' },
        PROVIDERS.map((p) =>
          h('div', { class: 'provider-card onboarding', style: `--brand:${p.color}` },
            h('div', { class: 'card-glow' }),
            providerBadge(p, 'large'),
            h('div', { class: 'card-name' }, p.name),
            h('div', { class: 'card-hint' }, p.description),
            h('button', { class: 'btn primary', onclick: () => connectProvider(p.id) }, 'Verbinden')))),
    );
  }

  root.replaceChildren(h('div', { class: 'page' }, sections));
  renderPlayer(true);
}

/* ---------- Anbieter verwalten ---------- */

function renderProviders() {
  const root = $('view-providers');
  const notices = [];
  if (!isDesktop) {
    notices.push(h('div', { class: 'notice' }, 'Das ist die Browser-Vorschau. Die Musikdienste laufen nur in der Moonify-Desktop-App.'));
  } else if (!info.widevine) {
    notices.push(h('div', { class: 'notice warn' }, 'Diese Moonify-Version enthält kein Widevine. Spotify und Amazon Music brauchen das für die Wiedergabe – bitte die offizielle Moonify-Version (mit castLabs-Electron) verwenden.'));
  }

  const cards = PROVIDERS.map((p) => {
    const on = settings.enabled[p.id];
    const status = statusLabel(p);
    const actions = on
      ? [
        h('button', { class: 'btn primary', onclick: () => showView({ kind: 'provider', id: p.id }) }, loginStatus[p.id] ? 'Öffnen' : 'Anmelden'),
        h('button', { class: 'btn ghost', onclick: () => disconnectProvider(p.id) }, 'Trennen'),
      ]
      : [h('button', { class: 'btn primary', onclick: () => connectProvider(p.id) }, 'Verbinden')];

    let extra = null;
    if (p.id === 'amazon') {
      const select = h('select', { class: 'select', 'aria-label': 'Amazon-Music-Region', onchange: (e) => setAmazonRegion(e.target.value) },
        Object.entries(AMAZON_REGIONS).map(([key, region]) =>
          h('option', { value: key, selected: key === settings.amazonRegion }, `${region.label} (${region.host})`)));
      extra = h('label', { class: 'field' }, h('span', {}, 'Region'), select);
    }

    return h('article', { class: `manage-card${on ? ' on' : ''}`, style: `--brand:${p.color}` },
      providerBadge(p, 'large'),
      h('div', { class: 'manage-body' },
        h('div', { class: 'manage-head' },
          h('h3', {}, p.name),
          h('span', { class: `pill ${status.cls}` }, status.text)),
        h('p', {}, p.description),
        extra),
      h('div', { class: 'manage-actions' }, actions));
  });

  root.replaceChildren(
    h('div', { class: 'page' },
      h('h1', { class: 'page-title' }, 'Anbieter'),
      h('p', { class: 'section-sub' }, 'Verbinde nur die Dienste, die du nutzt – einer reicht völlig. Suche, Startseite und Seitenleiste zeigen nur deine verbundenen Anbieter. Deine Logins bleiben in Moonify gespeichert und sind pro Anbieter getrennt.'),
      notices,
      h('div', { class: 'manage-list' }, cards)),
  );
}

/* ---------- Playerleiste ---------- */

let lastArt = null;
let lastHomeArt = null;

function setArt(container, url, cacheKey) {
  if (cacheKey === url) return url;
  container.replaceChildren(
    url
      ? h('img', { src: url, alt: '', referrerpolicy: 'no-referrer', draggable: 'false' })
      : h('div', { class: 'art-placeholder', html: moonSvg({ lit: 0.35, glow: false }) }),
  );
  return url;
}

function renderPlayer(force = false) {
  const current = hub.current();
  const provider = current ? getProvider(current.id) : null;

  if (force) {
    lastArt = null;
    lastHomeArt = null;
  }
  lastArt = setArt($('now-art'), current?.artwork || '', force ? null : lastArt);

  const title = current ? current.title || 'Unbekannter Titel' : 'Nichts läuft gerade';
  const artist = current ? current.artist || current.album || '' : 'Starte Musik bei einem deiner Anbieter';
  setText($('now-title'), title);
  setText($('now-artist'), artist);

  const source = $('now-source');
  source.hidden = !provider;
  if (provider && source.dataset.provider !== provider.id) {
    source.dataset.provider = provider.id;
    source.style.setProperty('--brand', provider.color);
    source.replaceChildren(h('span', { class: 'dot' }), `über ${provider.name}`);
  }

  const playing = Boolean(current?.playing);
  const play = $('btn-play');
  play.disabled = !current;
  if (play.dataset.state !== String(playing)) {
    play.dataset.state = String(playing);
    play.innerHTML = playing ? icons.pause : icons.play;
    play.setAttribute('aria-label', playing ? 'Pause' : 'Abspielen');
    play.title = playing ? 'Pause' : 'Abspielen';
  }
  $('btn-prev').disabled = !current?.canPrev;
  $('btn-next').disabled = !current?.canNext;

  const duration = current?.duration || 0;
  const position = current?.position || 0;
  progress.set({ position, duration, disabled: !current?.canSeek });
  setText($('time-current'), formatTime(position));
  setText($('time-total'), formatTime(duration));
  document.body.classList.toggle('is-playing', playing);

  const homeNow = $('home-now');
  if (homeNow) {
    homeNow.hidden = !current;
    if (current) {
      lastHomeArt = setArt($('home-now-art'), current.artwork, force ? null : lastHomeArt);
      setText($('home-now-label'), playing ? `Jetzt läuft · ${provider.name}` : `Pausiert · ${provider.name}`);
      setText($('home-now-title'), title);
      setText($('home-now-artist'), artist);
      $('home-now-open').onclick = () => showView({ kind: 'provider', id: current.id });
    }
  }

  document.title = current?.title && playing ? `${current.title} · Moonify` : 'Moonify';
}

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function togglePlay() {
  const current = hub.current();
  if (!current) return;
  command(current.id, { type: current.playing ? 'pause' : 'play' });
  hub.patch(current.id, { playing: !current.playing });
}

function applyVolumeUi() {
  const input = $('volume');
  const value = Math.round(effectiveVolume() * 100);
  input.value = String(value);
  input.style.setProperty('--fill', `${value}%`);
  const mute = $('btn-mute');
  mute.innerHTML = effectiveVolume() === 0 ? icons.muted : icons.volume;
  mute.setAttribute('aria-label', settings.muted ? 'Ton an' : 'Stumm schalten');
  mute.title = settings.muted ? 'Ton an' : 'Stumm schalten';
}

function setVolume(volume, muted = false) {
  settings.volume = volume;
  settings.muted = muted;
  saveSettings(settings);
  applyVolumeUi();
  for (const id of frames.keys()) sendVolume(id);
}

/* ---------- Dialog ---------- */

function openModal({ title, text, actions }) {
  const modal = $('modal');
  $('modal-title').textContent = title;
  $('modal-text').textContent = text;
  const close = () => {
    modal.hidden = true;
  };
  $('modal-actions').replaceChildren(
    ...actions.map((a) =>
      h('button', {
        class: `btn ${a.danger ? 'danger' : a.run ? 'primary' : 'ghost'}`,
        onclick: () => {
          close();
          a.run?.();
        },
      }, a.label)),
  );
  modal.hidden = false;
  modal.onclick = (e) => {
    if (e.target === modal) close();
  };
  modal.querySelector('.modal-actions button')?.focus();
}

/* ---------- Login-Status ---------- */

let loginTimer = 0;
function scheduleLoginRefresh() {
  clearTimeout(loginTimer);
  loginTimer = setTimeout(refreshLoginStatus, 800);
}

async function refreshLoginStatus() {
  let next = {};
  try {
    next = (await api.loginStatus()) || {};
  } catch {
    return;
  }
  if (JSON.stringify(next) === JSON.stringify(loginStatus)) return;
  loginStatus = next;
  renderSidebar();
  if (view.kind === 'home') renderHome();
  if (view.kind === 'providers') renderProviders();
}

/* ---------- Start ---------- */

function renderAll() {
  updateSearchPlaceholder();
  renderSidebar();
  if (view.kind === 'home') renderHome();
  if (view.kind === 'providers') renderProviders();
  renderSearchStrip();
}

function bindStaticUi() {
  $('brand-moon').innerHTML = moonSvg({ lit: 0.72, waxing: true });
  $('search-icon').innerHTML = icons.search;
  $('nav-back').innerHTML = icons.back;
  $('nav-forward').innerHTML = icons.forward;
  $('nav-reload').innerHTML = icons.reload;
  $('btn-prev').innerHTML = icons.prev;
  $('btn-next').innerHTML = icons.next;
  $('nav-home').innerHTML = `${icons.home}<span class="nav-label">Start</span>`;
  $('nav-manage').innerHTML = `${icons.plus}<span class="nav-label">Anbieter verwalten</span>`;
  $('search-kbd').textContent = info.platform === 'darwin' ? '⌘ K' : 'Strg K';

  $('nav-home').addEventListener('click', () => showView({ kind: 'home' }));
  $('nav-manage').addEventListener('click', () => showView({ kind: 'providers' }));
  $('nav-back').addEventListener('click', () => activeFrame()?.el.goBack());
  $('nav-forward').addEventListener('click', () => activeFrame()?.el.goForward());
  $('nav-reload').addEventListener('click', () => view.kind === 'provider' && reloadFrame(view.id));

  $('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch($('search-input').value);
    $('search-input').blur();
  });

  $('btn-play').addEventListener('click', togglePlay);
  $('btn-next').addEventListener('click', () => {
    const c = hub.current();
    if (c) command(c.id, { type: 'next' });
  });
  $('btn-prev').addEventListener('click', () => {
    const c = hub.current();
    if (c) command(c.id, { type: 'prev' });
  });
  $('now-source').addEventListener('click', () => {
    const c = hub.current();
    if (c) showView({ kind: 'provider', id: c.id });
  });

  $('volume').addEventListener('input', (e) => setVolume(Number(e.target.value) / 100, false));
  $('btn-mute').addEventListener('click', () => {
    if (settings.muted || settings.volume === 0) setVolume(settings.volume || 0.5, false);
    else setVolume(settings.volume, true);
  });

  progress = new MoonProgress($('progress'), {
    onSeek: (time) => {
      const c = hub.current();
      if (!c) return;
      command(c.id, { type: 'seek', time });
      hub.patch(c.id, { position: time });
    },
  });

  document.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target?.tagName === 'WEBVIEW';
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) {
      e.preventDefault();
      $('search-input').focus();
      $('search-input').select();
    } else if (e.key === 'Escape') {
      if (!$('modal').hidden) $('modal').hidden = true;
      else if (document.activeElement === $('search-input')) $('search-input').blur();
    } else if (e.code === 'Space' && !typing && !(e.target instanceof HTMLButtonElement) && !e.target?.closest?.('.moon-progress')) {
      e.preventDefault();
      togglePlay();
    }
  });

  let sidebarKey = '';
  hub.addEventListener('change', () => {
    renderPlayer();
    const current = hub.current();
    const key = current ? `${current.id}:${current.playing}` : '';
    if (key !== sidebarKey) {
      sidebarKey = key;
      renderSidebar();
    }
  });
}

function animate() {
  // Fortschritt flüssig hochrechnen, ohne auf jede Nachricht zu warten
  let last = 0;
  const frame = (time) => {
    requestAnimationFrame(frame);
    if (time - last < 66 || !hub.current()?.playing || progress.dragging) return;
    last = time;
    renderPlayer();
  };
  requestAnimationFrame(frame);
}

async function init() {
  try {
    info = { ...info, ...(await api.info()) };
  } catch {
    // Standardwerte behalten
  }
  document.body.classList.add(`platform-${info.platform}`);
  startStarfield($('sky'));
  bindStaticUi();
  applyVolumeUi();
  renderTonight();
  // Nur verbundene Anbieter werden überhaupt geladen.
  for (const provider of connected()) ensureFrame(provider.id);
  renderAll();
  showView({ kind: 'home' });
  animate();
  await refreshLoginStatus();
  setInterval(refreshLoginStatus, 15000);
  setInterval(renderTonight, 30 * 60 * 1000);
}

init();
