// Liest Songs und Playlists aus den Antworten der Web-Player.
// Die Funktionen suchen nach typischen Bausteinen statt festen Pfaden,
// damit kleine Umbauten bei den Anbietern nicht gleich alles kaputt machen.

/**
 * @typedef {{ provider: string, kind: 'track', id: string, title: string, artist: string,
 *   album: string, duration: number, image: string, ref: object }} Track
 * @typedef {{ provider: string, kind: 'playlist'|'album', id: string, name: string,
 *   subtitle: string, image: string, ref: object }} Collection
 */

/** Besucht alle Objekte; gibt `visit` false zurück, wird nicht tiefer gesucht. */
export function walk(node, visit) {
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) stack.push(current[i]);
    } else if (current && typeof current === 'object') {
      if (visit(current) === false) continue;
      const values = Object.values(current);
      for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] && typeof values[i] === 'object') stack.push(values[i]);
      }
    }
  }
}

function parse(json) {
  if (typeof json !== 'string') return json;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function text(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.text === 'string') return value.text;
  if (value && Array.isArray(value.runs)) return value.runs.map((r) => r.text || '').join('');
  return '';
}

function httpsImage(url) {
  return typeof url === 'string' && url.startsWith('https://') ? url : '';
}

/** Bild in passender Größe (um 300 px) aus einer Liste mit width/url wählen. */
export function pickImage(sources, target = 300) {
  const list = (Array.isArray(sources) ? sources : []).filter((s) => s && httpsImage(s.url));
  if (!list.length) return '';
  const sized = list.filter((s) => Number(s.width) > 0);
  if (!sized.length) return list[0].url;
  sized.sort((a, b) => Math.abs(a.width - target) - Math.abs(b.width - target));
  return sized[0].url;
}

/* ---------------- Spotify ---------------- */

function spotifyId(uri) {
  return String(uri || '').split(':').pop();
}

export function parseSpotifyTracks(json) {
  const data = parse(json);
  const tracks = [];
  const seen = new Set();
  walk(data, (o) => {
    if (o.__typename !== 'Track' || typeof o.uri !== 'string' || !o.uri.startsWith('spotify:track:')) return true;
    if (!seen.has(o.uri)) {
      seen.add(o.uri);
      const ms = o.duration?.totalMilliseconds ?? o.trackDuration?.totalMilliseconds ?? 0;
      tracks.push({
        provider: 'spotify',
        kind: 'track',
        id: spotifyId(o.uri),
        title: text(o.name),
        artist: (o.artists?.items || []).map((a) => a?.profile?.name).filter(Boolean).join(', '),
        album: text(o.albumOfTrack?.name),
        duration: Math.round(Number(ms) / 1000) || 0,
        image: pickImage(o.albumOfTrack?.coverArt?.sources),
        playable: o.playability?.playable !== false,
        ref: { uri: o.uri },
      });
    }
    return false;
  });
  return tracks;
}

export function parseSpotifyCollections(json) {
  const data = parse(json);
  const items = [];
  const seen = new Set();
  walk(data, (o) => {
    const uri = typeof o.uri === 'string' ? o.uri : '';
    const isPlaylist = uri.startsWith('spotify:playlist:') && typeof o.name === 'string';
    const isAlbum = o.__typename === 'Album' && uri.startsWith('spotify:album:') && typeof o.name === 'string';
    const isLiked = uri.endsWith(':collection') || uri === 'spotify:collection:tracks';
    if (!isPlaylist && !isAlbum && !(isLiked && o.__typename === 'PseudoPlaylist')) return true;
    if (!seen.has(uri)) {
      seen.add(uri);
      const image = pickImage(o.images?.items?.[0]?.sources) || pickImage(o.coverArt?.sources);
      items.push({
        provider: 'spotify',
        kind: isAlbum ? 'album' : 'playlist',
        id: isLiked ? 'liked' : spotifyId(uri),
        name: isLiked ? 'Lieblingssongs' : text(o.name),
        subtitle: isAlbum
          ? (o.artists?.items || []).map((a) => a?.profile?.name).filter(Boolean).join(', ')
          : text(o.ownerV2?.data?.name),
        image,
        ref: { uri: isLiked ? 'spotify:collection:tracks' : uri },
      });
    }
    return false;
  });
  return items;
}

/* ---------------- YouTube Music ---------------- */

const YT_TYPE_LABELS = new Set(['Song', 'Songs', 'Titel', 'Video', 'Videos', 'Single', 'EP', 'Album', 'Playlist', 'Folge', 'Episode']);
const DURATION = /^\d{1,2}(:\d{2}){1,2}$/;

function ytThumbnail(renderer) {
  const thumbs =
    renderer?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    renderer?.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    [];
  return pickImage(thumbs, 226);
}

function ytPageType(run) {
  return run?.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
}

function ytColumnRuns(renderer) {
  const flex = (renderer.flexColumns || []).map((c) => c?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []);
  const fixed = (renderer.fixedColumns || []).map((c) => c?.musicResponsiveListItemFixedColumnRenderer?.text?.runs || []);
  return { flex, fixed };
}

function ytVideoId(renderer) {
  if (renderer.playlistItemData?.videoId) return renderer.playlistItemData.videoId;
  let id = '';
  walk(renderer.overlay || renderer.flexColumns, (o) => {
    if (!id && o.watchEndpoint?.videoId) id = o.watchEndpoint.videoId;
    return !id;
  });
  return id;
}

export function parseYtmTracks(json) {
  const data = parse(json);
  const tracks = [];
  const seen = new Set();
  walk(data, (o) => {
    // „Top-Treffer“-Karte ganz oben in der Suche
    const card = o.musicCardShelfRenderer;
    if (card) {
      const titleRun = card.title?.runs?.find((x) => x.navigationEndpoint?.watchEndpoint?.videoId);
      const videoId = titleRun?.navigationEndpoint.watchEndpoint.videoId;
      const type = titleRun?.navigationEndpoint.watchEndpoint.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType || '';
      if (videoId && !seen.has(videoId) && !/PODCAST/.test(type)) {
        seen.add(videoId);
        const runs = card.subtitle?.runs || [];
        const artists = runs.filter((x) => /ARTIST|USER_CHANNEL/.test(ytPageType(x))).map((x) => String(x.text).trim());
        tracks.push({
          provider: 'ytmusic',
          kind: 'track',
          id: videoId,
          title: String(titleRun.text || '').trim(),
          artist: artists.join(', '),
          album: (runs.find((x) => /ALBUM/.test(ytPageType(x)))?.text || '').trim(),
          duration: parseDuration(runs.map((x) => x.text?.trim()).find((t) => DURATION.test(t || '')) || ''),
          image: ytThumbnail(card),
          playable: true,
          ref: { videoId },
        });
      }
      return true; // in der Karte können weitere Songs stecken
    }
    const r = o.musicResponsiveListItemRenderer;
    if (!r) return true;
    const videoId = ytVideoId(r);
    if (!videoId || seen.has(videoId) || /PODCAST/.test(JSON.stringify(r.overlay || ''))) return false;
    seen.add(videoId);
    const { flex, fixed } = ytColumnRuns(r);
    const title = (flex[0] || []).map((x) => x.text).join('').trim();
    const details = flex.slice(1).flat();
    const artists = details.filter((x) => /ARTIST|USER_CHANNEL/.test(ytPageType(x))).map((x) => String(x.text).trim());
    const album = (details.find((x) => /ALBUM/.test(ytPageType(x)))?.text || '').trim();
    const plain = details
      .map((x) => x.text)
      .join('')
      .split('•')
      .map((s) => s.trim())
      .filter(Boolean);
    const duration = [...details, ...fixed.flat()].map((x) => x.text?.trim()).find((t) => DURATION.test(t || '')) || '';
    const fallbackArtist = plain.filter((s) => !YT_TYPE_LABELS.has(s) && !DURATION.test(s) && s !== album)[0] || '';
    tracks.push({
      provider: 'ytmusic',
      kind: 'track',
      id: videoId,
      title,
      artist: artists.length ? artists.join(', ') : fallbackArtist,
      album,
      duration: parseDuration(duration),
      image: ytThumbnail(r),
      playable: true,
      ref: { videoId },
    });
    return false;
  });
  return tracks;
}

export function parseYtmCollections(json) {
  const data = parse(json);
  const items = [];
  const seen = new Set();
  walk(data, (o) => {
    const r = o.musicTwoRowItemRenderer;
    if (!r) return true;
    const browseId = r.navigationEndpoint?.browseEndpoint?.browseId || '';
    const isPlaylist = browseId.startsWith('VL');
    const isAlbum = browseId.startsWith('MPRE');
    if ((isPlaylist || isAlbum) && !seen.has(browseId)) {
      seen.add(browseId);
      items.push({
        provider: 'ytmusic',
        kind: isAlbum ? 'album' : 'playlist',
        id: browseId,
        name: browseId === 'VLLM' ? 'Lieblingssongs' : text(r.title),
        subtitle: text(r.subtitle),
        image: ytThumbnail(r),
        ref: { browseId, playlistId: isPlaylist ? browseId.slice(2) : '' },
      });
    }
    return false;
  });
  return items;
}

/** Filter-Chips einer YT-Music-Suche, z. B. „Titel“ → params. */
export function parseYtmChips(json) {
  const data = parse(json);
  const chips = [];
  walk(data, (o) => {
    const c = o.chipCloudChipRenderer;
    if (!c) return true;
    const params = c.navigationEndpoint?.searchEndpoint?.params;
    if (params) chips.push({ label: text(c.text), params });
    return false;
  });
  return chips;
}

export function ytmSongsChip(chips) {
  return chips.find((c) => /^(titel|songs|lieder)$/i.test(c.label.trim())) || null;
}

/* ---------------- Amazon Music ---------------- */

function amazonTrackAsin(deeplink) {
  const match = /[?&]trackAsin=([A-Z0-9]+)/i.exec(deeplink || '');
  return match ? match[1] : '';
}

export function parseAmazonTracks(json) {
  const data = parse(json);
  const tracks = [];
  const seen = new Set();
  walk(data, (o) => {
    if (typeof o.interface !== 'string' || !/(Horizontal|Vertical)ItemElement$|ImageRowElement$/.test(o.interface)) return true;
    const deeplink = o.primaryLink?.deeplink || '';
    const asin = amazonTrackAsin(deeplink);
    if (asin && !seen.has(asin)) {
      seen.add(asin);
      tracks.push({
        provider: 'amazon',
        kind: 'track',
        id: asin,
        title: text(o.primaryText),
        artist: text(o.secondaryText),
        album: '',
        duration: 0,
        image: httpsImage(o.image),
        playable: o.isDisabled !== true,
        ref: { deeplink },
      });
    }
    return false;
  });
  return tracks;
}

/* ---------------- Allgemein ---------------- */

export function parseDuration(value) {
  if (!DURATION.test(String(value || '').trim())) return 0;
  return String(value)
    .trim()
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
}

/** Ergebnisse mehrerer Anbieter abwechselnd mischen. */
export function interleave(lists) {
  const result = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) if (i < list.length) result.push(list[i]);
  }
  return result;
}

/** Wie viele Treffer enthalten mindestens ein Wort der Suche in Titel oder Künstler? */
export function relevantCount(tracks, query) {
  const words = String(query || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
  if (!words.length) return tracks.length;
  return tracks.filter((t) => {
    const haystack = `${t.title} ${t.artist} ${t.album}`.toLowerCase();
    return words.some((w) => haystack.includes(w));
  }).length;
}

/** Gefilterte Songs nur nehmen, wenn sie zur Suche passen – sonst die normalen Treffer. */
export function pickRelevant(filtered, unfiltered, query) {
  if (!filtered.length) return unfiltered;
  return relevantCount(filtered, query) === 0 && relevantCount(unfiltered, query) > 0 ? unfiltered : filtered;
}
