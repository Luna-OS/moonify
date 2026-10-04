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
    hosts: ['spotify.com', 'scdn.co', 'spotifycdn.com'],
    loginCookies: ['sp_dc'],
    home: () => 'https://open.spotify.com/',
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
    hosts: ['youtube.com', 'google.com', 'google.de', 'gstatic.com', 'googleusercontent.com', 'youtube-nocookie.com'],
    loginCookies: ['SAPISID', '__Secure-3PAPISID'],
    home: () => 'https://music.youtube.com/',
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
    hosts: [
      'amazon.de', 'amazon.com', 'amazon.co.uk', 'amazon.fr', 'amazon.it', 'amazon.es',
      'media-amazon.com', 'ssl-images-amazon.com', 'amazonmusic.com',
    ],
    loginCookies: ['at-main', 'at-acbde', 'x-main', 'x-acbde', 'sess-at-main', 'sess-at-acbde'],
    home: (options) => `https://${amazonHost(options)}/`,
    search: (query, options) => `https://${amazonHost(options)}/search/${encodeURIComponent(query)}`,
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
