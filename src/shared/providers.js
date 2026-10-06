// Gemeinsame Anbieter-Definitionen für Main-Prozess und Oberfläche.
// Jeder Anbieter läuft in einer eigenen, dauerhaften Sitzung (partition),
// damit Logins getrennt bleiben und nur verbundene Anbieter etwas laden.

export const AMAZON_REGIONS = {
  de: { label: 'Deutschland / Österreich / Schweiz', host: 'music.amazon.de' },
  com: { label: 'USA', host: 'music.amazon.com' },
  'co.uk': { label: 'Vereinigtes Königreich', host: 'music.amazon.co.uk' },
  fr: { label: 'Frankreich', host: 'music.amazon.fr' },
  it: { label: 'Italien', host: 'music.amazon.it' },
  es: { label: 'Spanien', host: 'music.amazon.es' },
};

export const DEFAULT_AMAZON_REGION = 'de';

function amazonHost(options = {}) {
  return (AMAZON_REGIONS[options.amazonRegion] || AMAZON_REGIONS[DEFAULT_AMAZON_REGION]).host;
}

// Domains, die für Logins (z. B. „Mit Apple / Google anmelden“) als Popup
// innerhalb der App geöffnet werden dürfen.
export const AUTH_HOSTS = [
  'accounts.google.com',
  'google.com',
  'appleid.apple.com',
  'idmsa.apple.com',
  'apple.com',
  'facebook.com',
];

export const PROVIDERS = [
  {
    id: 'spotify',
    name: 'Spotify',
    short: 'Spotify',
    color: '#1ed760',
    partition: 'persist:moonify-spotify',
    description: 'Playlists, Podcasts und deine Lieblingssongs aus Spotify.',
    needsDrm: true,
    library: true,
    hosts: ['spotify.com', 'scdn.co', 'spotifycdn.com'],
    loginCookies: ['sp_dc'],
    loginDomain: 'spotify.com',
    home: () => 'https://open.spotify.com/',
    login: () => 'https://accounts.spotify.com/de/login?continue=https%3A%2F%2Fopen.spotify.com%2F',
    search: (query) => `https://open.spotify.com/search/${encodeURIComponent(query)}`,
  },
  {
    id: 'ytmusic',
    name: 'YouTube Music',
    short: 'YT Music',
    color: '#ff4e45',
    partition: 'persist:moonify-ytmusic',
    description: 'Songs, Alben, Remixe und Musikvideos von YouTube Music.',
    needsDrm: false,
    library: true,
    hosts: ['youtube.com', 'google.com', 'google.de', 'gstatic.com', 'googleusercontent.com', 'youtube-nocookie.com'],
    loginCookies: ['SAPISID', '__Secure-3PAPISID'],
    loginDomain: 'youtube.com',
    home: () => 'https://music.youtube.com/',
    login: () =>
      'https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=' +
      encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&app=desktop&next=https%3A%2F%2Fmusic.youtube.com%2F'),
    search: (query) => `https://music.youtube.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    id: 'amazon',
    name: 'Amazon Music',
    short: 'Amazon',
    color: '#25d1da',
    partition: 'persist:moonify-amazon',
    description: 'Amazon Music Unlimited und Prime Music.',
    needsDrm: true,
    library: false,
    hosts: [
      'amazon.de', 'amazon.com', 'amazon.co.uk', 'amazon.fr', 'amazon.it', 'amazon.es',
      'media-amazon.com', 'ssl-images-amazon.com', 'amazonmusic.com',
    ],
    loginCookies: ['at-main', 'at-acbde', 'x-main', 'x-acbde', 'sess-at-main', 'sess-at-acbde'],
    loginDomain: 'amazon.',
    home: (options) => `https://${amazonHost(options)}/`,
    login: (options) => `https://${amazonHost(options)}/`,
    search: (query, options) =>
      `https://${amazonHost(options)}/search/${encodeURIComponent(query)}?filter=IsLibrary%7Cfalse&sc=none`,
  },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

export function getProviderByPartition(partition) {
  return PROVIDERS.find((p) => p.partition === partition) || null;
}

/** true, wenn `hostname` gleich `domain` ist oder eine Subdomain davon. */
export function hostMatches(hostname, domain) {
  const h = String(hostname || '').toLowerCase();
  const d = String(domain || '').toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

/** Gehört dieses Cookie zu einer Anmeldung bei diesem Anbieter? */
export function isLoginCookie(provider, cookie) {
  if (!provider || !cookie || !cookie.value) return false;
  if (!provider.loginCookies.includes(cookie.name)) return false;
  const domain = String(cookie.domain || '').replace(/^\./, '');
  return provider.loginDomain.endsWith('.') ? domain.includes(provider.loginDomain) : hostMatches(domain, provider.loginDomain);
}

/** Darf diese URL als Popup innerhalb der App geöffnet werden (Login etc.)? */
export function isInAppUrl(provider, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const domains = [...(provider ? provider.hosts : []), ...AUTH_HOSTS];
  return domains.some((d) => hostMatches(parsed.hostname, d));
}
