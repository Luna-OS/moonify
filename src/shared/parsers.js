// Liest Songs und Playlists aus den Antworten der Web-Player.
// Die Funktionen suchen nach typischen Bausteinen statt festen Pfaden,
// damit kleine Umbauten bei den Anbietern nicht gleich alles kaputt machen.

/**
 * @typedef {{ provider: string, kind: 'track', id: string, title: string, artist: string,
 *   album: string, duration: number, image: string, ref: object }} Track
 * @typedef {{ provider: string, kind: 'playlist'|'album', id: string, name: string,
 *   subtitle: string, image: string, ref: object }} Collection
 * @typedef {{ provider: string, kind: 'artist', id: string, name: string,
 *   subtitle: string, image: string, ref: object }} Artist
 * @typedef {{ tracks: Track[], playlists: Collection[], albums: Collection[], artists: Artist[],
 *   top: (Collection|Artist|null) }} SearchResults
 * @typedef {{ artist: Artist, tracks: Track[], albums: Collection[], playlists: Collection[],
 *   related: Artist[] }} ArtistPage
 */

export function emptySearch() {
  return { tracks: [], playlists: [], albums: [], artists: [], top: null };
}

function uniqueBy(list, key = (x) => `${x.provider}:${x.kind}:${x.id}`) {
  const seen = new Set();
  return list.filter((item) => {
    if (!item) return false;
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 94044806 → „94 Mio.“ */
export function compactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 }).format(n).replace(/\s/g, ' ');
}

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

function spotifyArtistNames(o) {
  return (o?.artists?.items || []).map((a) => a?.profile?.name).filter(Boolean).join(', ');
}

function spotifyTrack(o) {
  if (!o || typeof o.uri !== 'string' || !o.uri.startsWith('spotify:track:')) return null;
  const ms = o.duration?.totalMilliseconds ?? o.trackDuration?.totalMilliseconds ?? 0;
  return {
    provider: 'spotify',
    kind: 'track',
    id: spotifyId(o.uri),
    title: text(o.name),
    artist: spotifyArtistNames(o),
    album: text(o.albumOfTrack?.name),
    duration: Math.round(Number(ms) / 1000) || 0,
    image: pickImage(o.albumOfTrack?.coverArt?.sources),
    playable: o.playability?.playable !== false,
    ref: { uri: o.uri },
  };
}

export function parseSpotifyTracks(json) {
  const data = parse(json);
  const tracks = [];
  const seen = new Set();
  walk(data, (o) => {
    if (o.__typename !== 'Track' || typeof o.uri !== 'string' || !o.uri.startsWith('spotify:track:')) return true;
    if (!seen.has(o.uri)) {
      seen.add(o.uri);
      tracks.push(spotifyTrack(o));
    }
    return false;
  });
  return tracks;
}

const SPOTIFY_RELEASE_TYPES = { ALBUM: 'Album', SINGLE: 'Single', EP: 'EP', COMPILATION: 'Compilation' };

function spotifyAlbum(o, { withArtist = true } = {}) {
  if (!o || typeof o.uri !== 'string' || !o.uri.startsWith('spotify:album:')) return null;
  const year = o.date?.year ? String(o.date.year) : '';
  const subtitle = withArtist
    ? [spotifyArtistNames(o), year].filter(Boolean).join(' · ')
    : [SPOTIFY_RELEASE_TYPES[o.type] || 'Album', year].filter(Boolean).join(' · ');
  return { provider: 'spotify', kind: 'album', id: spotifyId(o.uri), name: text(o.name), subtitle, image: pickImage(o.coverArt?.sources), ref: { uri: o.uri } };
}

function spotifyPlaylist(o) {
  if (!o || typeof o.uri !== 'string' || !o.uri.startsWith('spotify:playlist:')) return null;
  return {
    provider: 'spotify',
    kind: 'playlist',
    id: spotifyId(o.uri),
    name: text(o.name),
    subtitle: text(o.ownerV2?.data?.name),
    image: pickImage(o.images?.items?.[0]?.sources),
    ref: { uri: o.uri },
  };
}

function spotifyArtist(o) {
  if (!o || typeof o.uri !== 'string' || !o.uri.startsWith('spotify:artist:') || !o.profile?.name) return null;
  return {
    provider: 'spotify',
    kind: 'artist',
    id: spotifyId(o.uri),
    name: text(o.profile.name),
    subtitle: 'Künstler',
    image: pickImage(o.visuals?.avatarImage?.sources),
    ref: { uri: o.uri },
  };
}

/** Einträge eines Abschnitts, egal ob als { data } oder { item: { data } } verpackt. */
function sectionItems(section, field = 'items') {
  return (Array.isArray(section?.[field]) ? section[field] : []).map((i) => i?.data || i?.item?.data || i);
}

/** Suche „Alles“ (searchDesktop): Playlists, Alben, Künstler und Songs. */
export function parseSpotifySearch(json) {
  const data = parse(json);
  let s = data?.data?.searchV2;
  if (!s) {
    walk(data, (o) => {
      if (s) return false;
      if (o.searchV2) s = o.searchV2;
      return !s;
    });
  }
  if (!s) return emptySearch();
  const top = sectionItems(s.topResultsV2, 'itemsV2')
    .map((o) => (o?.__typename === 'Artist' ? spotifyArtist(o) : o?.__typename === 'Album' ? spotifyAlbum(o) : o?.__typename === 'Playlist' ? spotifyPlaylist(o) : null))
    .find(Boolean) || null;
  return {
    tracks: uniqueBy(sectionItems(s.tracksV2).map(spotifyTrack)),
    playlists: uniqueBy(sectionItems(s.playlists).map(spotifyPlaylist)),
    albums: uniqueBy(sectionItems(s.albumsV2).map((o) => spotifyAlbum(o))),
    artists: uniqueBy(sectionItems(s.artists).map(spotifyArtist)),
    top,
  };
}

/** Künstlerseite (queryArtistOverview). */
export function parseSpotifyArtist(json) {
  const data = parse(json);
  let a = data?.data?.artistUnion;
  if (!a) {
    walk(data, (o) => {
      if (a) return false;
      if (o.__typename === 'Artist' && o.discography) a = o;
      return !a;
    });
  }
  if (!a) return null;
  const disc = a.discography || {};
  const releases = (section) => (section?.items || []).map((i) => i?.releases?.items?.[0] || i);
  const listeners = compactNumber(a.stats?.monthlyListeners);
  const artist = spotifyArtist({ uri: a.uri, profile: a.profile, visuals: a.visuals }) || { provider: 'spotify', kind: 'artist', id: '', name: text(a.profile?.name), image: '', ref: {} };
  artist.subtitle = listeners ? `${listeners} Hörer im Monat` : 'Künstler';
  return {
    artist,
    tracks: uniqueBy((disc.topTracks?.items || []).map((i) => spotifyTrack(i?.track || i))),
    albums: uniqueBy([...releases(disc.popularReleasesAlbums), ...releases(disc.albums), ...releases(disc.singles)].map((o) => spotifyAlbum(o, { withArtist: false }))),
    playlists: uniqueBy([...sectionItems(a.profile?.playlistsV2), ...sectionItems(a.relatedContent?.featuringV2)].map(spotifyPlaylist)),
    related: uniqueBy((a.relatedContent?.relatedArtists?.items || []).map(spotifyArtist)),
  };
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

const YT_KIND_LABELS = /^(album|alben|single|ep|playlist|playlists|künstler|artist|artists|profil|profile|video|videos|song|songs|titel)$/i;

/** „Playlist • ALAN&PABLO • 216.396 Aufrufe“ → „ALAN&PABLO • 216.396 Aufrufe“ */
function ytSubtitle(value) {
  const parts = text(value)
    .replace(/\s/g, ' ')
    .split('•')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length > 1 && YT_KIND_LABELS.test(parts[0])) parts.shift();
  return parts.join(' • ');
}

/** playlistId aus dem Abspiel-Knopf (z. B. OLAK5uy_… bei Alben). */
function ytOverlayPlaylistId(node) {
  let id = '';
  walk(node, (o) => {
    if (!id && o.watchPlaylistEndpoint?.playlistId) id = o.watchPlaylistEndpoint.playlistId;
    if (!id && o.watchEndpoint?.playlistId) id = o.watchEndpoint.playlistId;
    return !id;
  });
  return id;
}

/** Playlist, Album oder Künstler aus einem Link auf eine YT-Music-Seite. */
function ytBrowseItem({ endpoint, name, subtitle, image, playlistId }) {
  const browseId = endpoint?.browseEndpoint?.browseId || '';
  const pageType = ytPageType({ navigationEndpoint: endpoint });
  const base = { provider: 'ytmusic', id: browseId, name: String(name || '').trim(), subtitle: ytSubtitle(subtitle), image };
  if (!browseId || !base.name) return null;
  if (/ARTIST/.test(pageType)) return { ...base, kind: 'artist', ref: { browseId } };
  if (/ALBUM/.test(pageType) || browseId.startsWith('MPRE')) return { ...base, kind: 'album', ref: { browseId, playlistId: playlistId || '' } };
  if (/PLAYLIST/.test(pageType) || browseId.startsWith('VL')) {
    return { ...base, kind: 'playlist', ref: { browseId, playlistId: browseId.startsWith('VL') ? browseId.slice(2) : playlistId || '' } };
  }
  return null; // Profile, Podcasts …
}

function ytItemFromRow(r) {
  const { flex } = ytColumnRuns(r);
  return ytBrowseItem({
    endpoint: r.navigationEndpoint,
    name: (flex[0] || []).map((x) => x.text).join(''),
    subtitle: { runs: flex.slice(1).flat() },
    image: ytThumbnail(r),
    playlistId: ytOverlayPlaylistId(r.overlay),
  });
}

function ytItemFromTwoRow(r) {
  return ytBrowseItem({
    endpoint: r.navigationEndpoint,
    name: text(r.title),
    subtitle: r.subtitle,
    image: ytThumbnail(r),
    playlistId: ytOverlayPlaylistId(r.thumbnailOverlay),
  });
}

/** Alle Playlists, Alben und Künstler einer Antwort (Listen- und Kachel-Ansicht). */
function ytBrowseItems(data) {
  const items = [];
  walk(data, (o) => {
    if (o.musicResponsiveListItemRenderer) {
      items.push(ytItemFromRow(o.musicResponsiveListItemRenderer));
      return false;
    }
    if (o.musicTwoRowItemRenderer) {
      items.push(ytItemFromTwoRow(o.musicTwoRowItemRenderer));
      return false;
    }
    return true;
  });
  return uniqueBy(items);
}

function ytTopResult(data) {
  let top = null;
  walk(data, (o) => {
    if (top) return false;
    const card = o.musicCardShelfRenderer;
    if (!card) return true;
    const run = (card.title?.runs || []).find((x) => x.navigationEndpoint?.browseEndpoint);
    if (run) top = ytBrowseItem({ endpoint: run.navigationEndpoint, name: run.text, subtitle: card.subtitle, image: ytThumbnail(card) });
    return false;
  });
  return top;
}

/** Suche „Alles“: Songs, Playlists, Alben und Künstler. */
export function parseYtmSearch(json) {
  const data = parse(json);
  if (!data) return emptySearch();
  const items = ytBrowseItems(data);
  const top = ytTopResult(data);
  const withTop = top ? uniqueBy([top, ...items]) : items;
  return {
    tracks: parseYtmTracks(data),
    playlists: withTop.filter((i) => i.kind === 'playlist'),
    albums: withTop.filter((i) => i.kind === 'album'),
    artists: withTop.filter((i) => i.kind === 'artist'),
    top,
  };
}

/** Song aus einer Kachel (z. B. „Videos“ auf der Künstlerseite). */
function ytTrackFromTwoRow(r) {
  const watch = r.navigationEndpoint?.watchEndpoint;
  if (!watch?.videoId || /PODCAST/.test(JSON.stringify(watch))) return null;
  const runs = r.subtitle?.runs || [];
  const artists = runs.filter((x) => /ARTIST|USER_CHANNEL/.test(ytPageType(x))).map((x) => String(x.text).trim());
  const plain = text(r.subtitle).split('•').map((p) => p.trim()).filter(Boolean);
  return {
    provider: 'ytmusic',
    kind: 'track',
    id: watch.videoId,
    title: text(r.title).trim(),
    artist: artists.length ? artists.join(', ') : plain.find((p) => !YT_TYPE_LABELS.has(p) && !/Aufrufe|views/i.test(p)) || '',
    album: '',
    duration: 0,
    image: ytThumbnail(r),
    playable: true,
    ref: { videoId: watch.videoId },
  };
}

/** Künstlerseite (browse mit UC…-ID). */
export function parseYtmArtist(json) {
  const data = parse(json);
  if (!data) return null;
  const header = Object.values(data.header || {})[0] || {};
  const name = text(header.title).trim();
  let songs = [];
  const videos = [];
  walk(data.contents, (o) => {
    if (o.musicShelfRenderer) {
      songs = songs.concat(parseYtmTracks(o.musicShelfRenderer));
      return false;
    }
    if (o.musicTwoRowItemRenderer) {
      const track = ytTrackFromTwoRow(o.musicTwoRowItemRenderer);
      if (track) videos.push(track);
      return false;
    }
    return true;
  });
  const items = ytBrowseItems(data.contents);
  const listeners = (text(header.monthlyListenerCount) || text(header.subscriptionButton?.subscribeButtonRenderer?.subscriberCountText)).replace(/\s/g, ' ');
  return {
    artist: {
      provider: 'ytmusic',
      kind: 'artist',
      id: '',
      name,
      subtitle: listeners || 'Künstler',
      image: pickImage(header.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || header.foregroundThumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails, 540),
      ref: {},
    },
    // Ohne Songliste (z. B. in manchen Regionen) die Videos nehmen
    tracks: uniqueBy(songs.length ? songs : videos),
    albums: items.filter((i) => i.kind === 'album'),
    playlists: items.filter((i) => i.kind === 'playlist'),
    related: items.filter((i) => i.kind === 'artist'),
  };
}

/** playlistId eines Albums/einer Playlist aus der Songliste (für „Abspielen“ im Zusammenhang). */
export function ytmPlaylistId(json) {
  const data = parse(json);
  let id = '';
  walk(data, (o) => {
    if (id) return false;
    const r = o.musicResponsiveListItemRenderer;
    if (!r) return true;
    walk(r.overlay, (x) => {
      const candidate = x.watchEndpoint?.playlistId || x.watchPlaylistEndpoint?.playlistId;
      if (!id && candidate && !candidate.startsWith('RD')) id = candidate;
      return !id;
    });
    return false;
  });
  return id;
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

function amazonName(primaryText, item) {
  // Bei Playlists steht der Name manchmal nur im „Platzhalter“ oder im Bildtext
  return (text(primaryText) || text(primaryText?.observer?.defaultValue) || (typeof item.imageAltText === 'string' ? item.imageAltText : '')).trim();
}

/** Alben, Playlists und Künstler aus der Amazon-Suche. */
function amazonBrowseItem(o) {
  const deeplink = o.primaryLink?.deeplink || '';
  if (!deeplink || amazonTrackAsin(deeplink)) return null;
  const match = /^\/(albums|playlists|user-playlists|artists)\/([A-Za-z0-9]+)/.exec(deeplink);
  if (!match) return null;
  const name = amazonName(o.primaryText, o);
  if (!name) return null;
  const kind = match[1] === 'albums' ? 'album' : match[1] === 'artists' ? 'artist' : 'playlist';
  const secondary = text(o.secondaryText);
  const tertiary = text(o.tertiaryText);
  return {
    provider: 'amazon',
    kind,
    id: match[2],
    name,
    subtitle: kind === 'artist' ? 'Künstler' : [secondary, tertiary].filter(Boolean).join(' · '),
    image: httpsImage(o.image),
    ref: { deeplink: deeplink.split('?')[0] },
  };
}

export function parseAmazonSearch(json) {
  const data = parse(json);
  if (!data) return emptySearch();
  const items = [];
  walk(data, (o) => {
    if (typeof o.interface !== 'string' || !/ItemElement$/.test(o.interface)) return true;
    items.push(amazonBrowseItem(o));
    return false;
  });
  const unique = uniqueBy(items);
  return {
    tracks: parseAmazonTracks(data),
    playlists: unique.filter((i) => i.kind === 'playlist'),
    albums: unique.filter((i) => i.kind === 'album'),
    artists: unique.filter((i) => i.kind === 'artist'),
    top: null,
  };
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
