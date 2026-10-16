// Songtexte von LRCLIB (https://lrclib.net) – frei, ohne API-Schlüssel, oft mit Zeitstempeln.
// Wird im Main-Prozess (Abruf) und in der Oberfläche (Anzeige) genutzt.

export const LYRICS_API = 'https://lrclib.net/api';

// Zusätze, die bei Video-Titeln häufig in Klammern stehen und den Songtext nicht ändern
const NOISE = /\b(official|offizielle?s?|video|audio|lyrics?|lyric video|visuali[sz]er|musikvideo|music video|remaster(ed)?|hd|hq|4k|live|mv|explicit|clean|version|edit|mono|stereo|feat\.?|ft\.?|featuring|with|prod\.?)\b/i;
const SUFFIX = /\s[-–—]\s.*\b(remaster(ed)?|version|edit|mono|stereo|live|single|bonus|mix|from)\b.*$/i;

/** „Yellow (Official Video)“ → „Yellow“, „Song - Remastered 2011“ → „Song“. */
export function cleanTitle(title, artist = '') {
  let t = String(title || '').trim();
  // YouTube-Videos heißen oft „Künstler - Titel“
  const primary = primaryArtist(artist);
  if (primary) {
    const prefix = new RegExp(`^${escapeRegExp(primary)}\\s*[-–—:]\\s+`, 'i');
    t = t.replace(prefix, '');
  }
  t = t.replace(/\s*[([{【]([^)\]}】]*)[)\]}】]/g, (whole, inner) => (NOISE.test(inner) ? '' : whole));
  t = t.replace(SUFFIX, '');
  t = t.replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '');
  return t.replace(/\s+/g, ' ').trim();
}

/** „Coldplay - Topic“, „ColdplayVEVO“, „Coldplay • Parachutes • 2000“ → „Coldplay“. */
export function cleanArtist(artist) {
  return String(artist || '')
    .split(/\s+[•·]\s+/)[0]
    .replace(/\s+-\s+Topic$/i, '')
    .replace(/(?<=\S)VEVO$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Erster Künstler: „A, B & C“ → „A“. */
export function primaryArtist(artist) {
  return cleanArtist(artist).split(/\s*(?:,|;|\/|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\bund\b|\band\b)\s+/i)[0].trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Zum Vergleichen: klein, ohne Akzente, Satzzeichen und Leerzeichen. */
export function normalizeName(text) {
  return String(text || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function similar(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)));
}

/** LRC-Text („[01:02.34]Zeile“) → [{ time: 62.34, text: 'Zeile' }], nach Zeit sortiert. */
export function parseLrc(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const stamps = [];
    let rest = raw;
    let match;
    while ((match = /^\s*\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/.exec(rest))) {
      const fraction = match[3] ? Number(match[3]) / 10 ** match[3].length : 0;
      stamps.push(Number(match[1]) * 60 + Number(match[2]) + fraction);
      rest = rest.slice(match[0].length);
    }
    const line = rest.trim();
    for (const time of stamps) lines.push({ time: Math.round(time * 1000) / 1000, text: line });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** Index der Zeile, die bei `position` (Sekunden) gerade gesungen wird, sonst -1. */
export function activeLineIndex(lines, position, lead = 0.2) {
  if (!Array.isArray(lines) || !lines.length) return -1;
  const t = Number(position) + lead;
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Datensatz von LRCLIB → Ergebnis für die Oberfläche (oder null ohne Text). */
export function toLyrics(record) {
  if (!record || typeof record !== 'object') return null;
  const synced = parseLrc(record.syncedLyrics).filter((line, i, all) => line.text || (i > 0 && all[i - 1].text));
  const plain = typeof record.plainLyrics === 'string' ? record.plainLyrics.trim() : '';
  const instrumental = record.instrumental === true;
  if (!instrumental && !plain && !synced.some((l) => l.text)) return null;
  return {
    instrumental,
    synced: synced.some((l) => l.text) ? synced : null,
    plain: plain || (synced.length ? synced.map((l) => l.text).join('\n') : ''),
    trackName: String(record.trackName || record.name || ''),
    artistName: String(record.artistName || ''),
  };
}

/** Bewertet einen Suchtreffer; -Infinity = passt nicht. */
export function scoreRecord(record, { title, artist, duration }) {
  if (!record || !similar(record.trackName || record.name, title)) return -Infinity;
  let score = 0;
  if (normalizeName(record.trackName || record.name) === normalizeName(title)) score += 3;
  if (artist) {
    if (similar(record.artistName, artist) || similar(primaryArtist(record.artistName), artist)) score += 4;
    else return -Infinity;
  }
  const diff = duration > 0 && record.duration > 0 ? Math.abs(record.duration - duration) : null;
  if (diff !== null) {
    if (diff > 20) return -Infinity;
    score += diff <= 2 ? 3 : diff <= 6 ? 1 : -1;
  }
  if (record.syncedLyrics) score += 2;
  else if (record.plainLyrics) score += 1;
  else if (!record.instrumental) return -Infinity;
  return score;
}

export function pickBest(records, query) {
  let best = null;
  let bestScore = -Infinity;
  for (const record of Array.isArray(records) ? records.slice(0, 40) : []) {
    const score = scoreRecord(record, query);
    if (score > bestScore) {
      best = record;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Sucht den Songtext zu einem Song.
 * `fetchJson(url)` liefert { status, data } und wirft bei Netzwerkfehlern.
 * Ergebnis: Songtext-Objekt oder null (sicher keiner gefunden). Wirft, wenn nichts gefunden
 * wurde, aber nicht alle Abfragen geklappt haben (LRCLIB ist zeitweise überlastet).
 */
export async function findLyrics(track, fetchJson) {
  const artist = primaryArtist(track?.artist);
  const title = cleanTitle(track?.title, track?.artist);
  if (!title) return null;
  const duration = Number(track?.duration) > 0 ? Math.round(Number(track.duration)) : 0;
  const query = { title, artist, duration };
  const attempts = [];
  if (artist) {
    // 1. Direkter Treffer (schnell, von LRCLIB empfohlen)
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (duration) params.set('duration', String(duration));
    attempts.push({ url: `${LYRICS_API}/get?${params}`, single: true });
    // 2. Suche nach Titel + Künstler
    attempts.push({ url: `${LYRICS_API}/search?${new URLSearchParams({ track_name: title, artist_name: artist })}` });
  }
  // 3. Freie Suche (z. B. wenn der Künstler anders geschrieben wird)
  attempts.push({ url: `${LYRICS_API}/search?${new URLSearchParams({ q: artist ? `${title} ${artist}` : title })}` });

  let failure = null;
  for (const { url, single } of attempts) {
    let reply;
    try {
      reply = await fetchJson(url);
    } catch (err) {
      failure = err; // nächste Abfrage probieren
      continue;
    }
    if (reply.status !== 200) continue;
    const record = single ? (scoreRecord(reply.data, query) > -Infinity ? reply.data : null) : pickBest(reply.data, query);
    const result = toLyrics(record);
    if (result) return result;
  }
  if (failure) throw failure;
  return null;
}

/** Abruf mit Zwischenspeicher; im Main-Prozess genutzt. */
export function createLyricsService(fetchImpl, { userAgent = 'Moonify', timeout = 12000, wait = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  const cache = new Map(); // Schlüssel → { result, at }
  const pending = new Map();
  const MISS_TTL = 10 * 60 * 1000; // „kein Songtext“ nur 10 Minuten merken

  async function fetchJson(url) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeout),
      });
      if (response.status === 404) return { status: 404, data: null };
      // LRCLIB ist manchmal kurz überlastet – zweimal nachfassen
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await wait(1000 * (attempt + 1));
        continue;
      }
      if (!response.ok) throw new Error(`LRCLIB antwortet mit ${response.status}`);
      return { status: 200, data: await response.json() };
    }
  }

  return async function lookup(track) {
    const key = [normalizeName(cleanTitle(track?.title, track?.artist)), normalizeName(primaryArtist(track?.artist)), Math.round(Number(track?.duration) || 0)].join('|');
    const cached = cache.get(key);
    if (cached && (cached.result || now() - cached.at < MISS_TTL)) return cached.result;
    if (pending.has(key)) return pending.get(key);
    const job = findLyrics(track, fetchJson)
      .then((result) => {
        cache.delete(key);
        cache.set(key, { result, at: now() });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        return result;
      })
      .finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  };
}
