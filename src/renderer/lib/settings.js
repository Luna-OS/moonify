import { AMAZON_REGIONS, DEFAULT_AMAZON_REGION, PROVIDER_IDS } from '../../shared/providers.js';

const KEY = 'moonify.settings.v1';

export function defaultSettings() {
  return {
    // Kein Anbieter ist Pflicht – alle starten ausgeschaltet.
    enabled: Object.fromEntries(PROVIDER_IDS.map((id) => [id, false])),
    amazonRegion: DEFAULT_AMAZON_REGION,
    volume: 0.8,
    muted: false,
  };
}

export function sanitizeSettings(raw) {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') return base;
  for (const id of PROVIDER_IDS) base.enabled[id] = raw.enabled?.[id] === true;
  if (Object.hasOwn(AMAZON_REGIONS, raw.amazonRegion)) base.amazonRegion = raw.amazonRegion;
  const volume = Number(raw.volume);
  if (Number.isFinite(volume)) base.volume = Math.min(1, Math.max(0, volume));
  base.muted = raw.muted === true;
  return base;
}

export function loadSettings(storage = globalThis.localStorage) {
  try {
    return sanitizeSettings(JSON.parse(storage.getItem(KEY) || 'null'));
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings, storage = globalThis.localStorage) {
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Speichern nicht möglich – App funktioniert trotzdem weiter
  }
}

export function enabledIds(settings) {
  return PROVIDER_IDS.filter((id) => settings.enabled[id]);
}
