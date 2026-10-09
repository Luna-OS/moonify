// Moonifys Warteschlange: spielt Songs nacheinander – auch über verschiedene Dienste hinweg.

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Passt der gerade gemeldete Titel zum Song, den Moonify gestartet hat? */
export function titlesMatch(expected, actual) {
  const a = normalize(expected);
  const b = normalize(actual);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export class Queue extends EventTarget {
  constructor() {
    super();
    this.items = [];
    this.index = -1;
  }

  get active() {
    return this.index >= 0 && this.index < this.items.length;
  }

  current() {
    return this.active ? this.items[this.index] : null;
  }

  upcoming() {
    return this.items.slice(this.index + 1);
  }

  /** Neue Liste abspielen, beginnend bei `start`. */
  set(tracks, start = 0) {
    this.items = [...tracks];
    this.index = this.items.length ? Math.min(Math.max(0, start), this.items.length - 1) : -1;
    this.changed();
    return this.current();
  }

  /** Einzelnen Song starten: bisherige Warteschlange danach behalten. */
  playNow(track) {
    const rest = this.upcoming();
    this.items = [track, ...rest];
    this.index = 0;
    this.changed();
    return track;
  }

  playNext(track) {
    if (!this.active) return this.playNow(track);
    this.items.splice(this.index + 1, 0, track);
    this.changed();
    return null;
  }

  add(track) {
    if (!this.active) return this.playNow(track);
    this.items.push(track);
    this.changed();
    return null;
  }

  next() {
    if (this.index + 1 >= this.items.length) {
      this.index = this.items.length;
      this.changed();
      return null;
    }
    this.index += 1;
    this.changed();
    return this.current();
  }

  previous() {
    if (this.index <= 0) return null;
    this.index -= 1;
    this.changed();
    return this.current();
  }

  remove(position) {
    const i = this.index + 1 + position;
    if (i <= this.index || i >= this.items.length) return false;
    this.items.splice(i, 1);
    this.changed();
    return true;
  }

  clear() {
    this.items = [];
    this.index = -1;
    this.changed();
  }

  changed() {
    this.dispatchEvent(new Event('change'));
  }
}

/**
 * Erkennt, wann der von Moonify gestartete Song zu Ende ist.
 * `observe` bekommt jeden neuen Wiedergabe-Zustand; gibt true zurück, wenn
 * der nächste Song der Warteschlange starten soll.
 */
export class EndDetector {
  constructor() {
    this.reset(null);
  }

  reset(track, now = Date.now()) {
    this.track = track;
    this.started = false;
    this.startedAt = now;
    this.playingTitle = '';
    this.fired = false;
  }

  observe(providerId, state, now = Date.now()) {
    if (!this.track || this.fired || !state || providerId !== this.track.provider) return false;
    if (!this.started) {
      // Gilt als gestartet, wenn der richtige Titel läuft (oder nach 20 s irgendetwas läuft)
      const matches = titlesMatch(this.track.title, state.title);
      if (state.playing && state.title && (matches || now - this.startedAt > 20000)) {
        this.started = true;
        this.playingTitle = state.title;
      }
      return false;
    }
    const nearEnd = state.duration > 0 && state.position >= state.duration - 1.5;
    const ended = nearEnd && !state.playing;
    // Der Dienst spielt von selbst etwas anderes → unser Song ist vorbei
    const switched = Boolean(state.title) && state.playing && !titlesMatch(this.playingTitle, state.title);
    if (ended || switched) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
