/** Sekunden → „3:07“ bzw. „1:02:45“. */
export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Nur https-Bilder zulassen (Cover kommen von den Anbieter-CDNs). */
export function safeImageUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function text(value, max = 300) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Zustand aus einer Anbieter-Ansicht prüfen und bereinigen. */
export function normalizeState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const duration = num(r.duration);
  return {
    title: text(r.title),
    artist: text(r.artist),
    album: text(r.album),
    artwork: safeImageUrl(r.artwork),
    playing: r.playing === true,
    duration,
    position: duration ? Math.min(num(r.position), duration) : num(r.position),
    canNext: r.canNext === true,
    canPrev: r.canPrev === true,
    canSeek: r.canSeek === true,
  };
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Gute Nacht';
  if (h < 11) return 'Guten Morgen';
  if (h < 17) return 'Hallo';
  if (h < 22) return 'Guten Abend';
  return 'Gute Nacht';
}
