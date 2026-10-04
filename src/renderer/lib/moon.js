// Mond-Zeichnung als SVG: von der schmalen Sichel bis zum Vollmond.

const SYNODIC_MONTH = 29.530588853;
// Referenz-Neumond: 6. Januar 2000, 18:14 UTC
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/**
 * SVG-Pfad des beleuchteten Teils einer Mondscheibe.
 * @param {number} lit   beleuchteter Anteil 0 (Neumond) … 1 (Vollmond)
 * @param {boolean} waxing  zunehmend (rechts hell) oder abnehmend (links hell)
 */
export function litPath(lit, waxing = true, r = 10, cx = 12, cy = 12) {
  const k = Math.min(1, Math.max(0, Number(lit) || 0));
  if (k <= 0.001) return '';
  const top = `${cx} ${round(cy - r)}`;
  const bottom = `${cx} ${round(cy + r)}`;
  if (k >= 0.999) {
    return `M ${top} A ${r} ${r} 0 1 1 ${bottom} A ${r} ${r} 0 1 1 ${top} Z`;
  }
  const rx = round(r * Math.abs(1 - 2 * k));
  // Außenrand: rechte Hälfte bei zunehmendem, linke bei abnehmendem Mond.
  const outerSweep = waxing ? 1 : 0;
  // Schattengrenze (Terminator): wölbt sich bei Sichel zur hellen Seite,
  // bei Dreiviertelmond zur dunklen Seite.
  const gibbous = k > 0.5;
  const innerSweep = waxing === gibbous ? 1 : 0;
  return `M ${top} A ${r} ${r} 0 0 ${outerSweep} ${bottom} A ${rx} ${r} 0 0 ${innerSweep} ${top} Z`;
}

/** Fortschritt 0…1 → beleuchteter Anteil (startet als Sichel, endet als Vollmond). */
export function progressToLit(progress) {
  const p = Math.min(1, Math.max(0, Number(progress) || 0));
  return 0.12 + 0.88 * p;
}

/** Echte Mondphase für ein Datum. */
export function lunarPhase(date = new Date()) {
  const days = (date.getTime() - KNOWN_NEW_MOON) / 86400000;
  const age = ((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const lit = (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH)) / 2;
  const waxing = age < SYNODIC_MONTH / 2;
  return { age, lit, waxing, name: phaseName(age) };
}

function phaseName(age) {
  const f = age / SYNODIC_MONTH;
  if (f < 0.0339 || f >= 0.9661) return 'Neumond';
  if (f < 0.2161) return 'Zunehmende Sichel';
  if (f < 0.2839) return 'Erstes Viertel';
  if (f < 0.4661) return 'Zunehmender Mond';
  if (f < 0.5339) return 'Vollmond';
  if (f < 0.7161) return 'Abnehmender Mond';
  if (f < 0.7839) return 'Letztes Viertel';
  return 'Abnehmende Sichel';
}

let uid = 0;

/**
 * Vollständiges Mond-SVG (Schattenseite, Licht, Krater, Schein).
 * Gibt einen String zurück; `updateMoon` aktualisiert nur die Phase.
 */
export function moonSvg({ lit = 1, waxing = true, glow = true, className = '' } = {}) {
  const id = `moon${++uid}`;
  return `
<svg class="moon ${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="${id}-light" cx="38%" cy="35%" r="75%">
      <stop offset="0%" stop-color="#fffdf3"/>
      <stop offset="55%" stop-color="#f1ecd8"/>
      <stop offset="100%" stop-color="#cfc6a8"/>
    </radialGradient>
    <radialGradient id="${id}-dark" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#2d3358"/>
      <stop offset="100%" stop-color="#181c38"/>
    </radialGradient>
    <radialGradient id="${id}-glow" cx="50%" cy="50%" r="50%">
      <stop offset="76%" stop-color="#fff3d6" stop-opacity="0.38"/>
      <stop offset="100%" stop-color="#fff3d6" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="${id}-clip"><path class="moon-lit-clip" d="${litPath(lit, waxing)}"/></clipPath>
  </defs>
  ${glow ? `<circle class="moon-glow" cx="12" cy="12" r="13" fill="url(#${id}-glow)"/>` : ''}
  <circle cx="12" cy="12" r="10" fill="url(#${id}-dark)"/>
  <path class="moon-lit" d="${litPath(lit, waxing)}" fill="url(#${id}-light)"/>
  <g clip-path="url(#${id}-clip)" fill="#bdb291" opacity="0.55">
    <circle cx="9" cy="8.5" r="1.9"/>
    <circle cx="15.2" cy="13.6" r="2.4"/>
    <circle cx="10.4" cy="15.8" r="1.2"/>
    <circle cx="16" cy="7.6" r="0.9"/>
    <circle cx="6.6" cy="12.6" r="0.8"/>
  </g>
  <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="0.4"/>
</svg>`;
}

export function updateMoon(svg, lit, waxing = true) {
  if (!svg) return;
  const d = litPath(lit, waxing);
  svg.querySelector('.moon-lit')?.setAttribute('d', d);
  svg.querySelector('.moon-lit-clip')?.setAttribute('d', d);
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}
