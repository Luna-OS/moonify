import { normalizeState } from './format.js';

/**
 * Sammelt den Wiedergabe-Zustand aller verbundenen Anbieter und entscheidet,
 * welcher davon in der Moonify-Playerleiste angezeigt wird.
 * Startet ein Anbieter die Wiedergabe, werden die anderen pausiert.
 */
export class PlayerHub extends EventTarget {
  constructor(now = () => performance.now()) {
    super();
    this.now = now;
    this.states = new Map();
    this.activeId = null;
  }

  update(id, raw) {
    const state = normalizeState(raw);
    state.receivedAt = this.now();
    const previous = this.states.get(id);
    this.states.set(id, state);

    const started = state.playing && !previous?.playing;
    if (started && this.activeId !== id) {
      const others = [...this.states].filter(([other, s]) => other !== id && s.playing).map(([other]) => other);
      this.activeId = id;
      if (others.length) this.dispatchEvent(new CustomEvent('pause-others', { detail: { ids: others } }));
    } else if (!this.activeId && state.title) {
      this.activeId = id;
    } else if (this.activeId === id && isEmpty(state)) {
      // Seite ohne Song (z. B. neu geladen) – zu einem anderen Anbieter wechseln, falls vorhanden
      this.activeId = this.fallback(id);
    }
    this.emitChange();
  }

  fallback(exclude) {
    const others = [...this.states].filter(([id, s]) => id !== exclude && !isEmpty(s));
    const next = others.find(([, s]) => s.playing) || others[0];
    return next ? next[0] : this.states.has(exclude) ? exclude : null;
  }

  remove(id) {
    this.states.delete(id);
    if (this.activeId === id) {
      const next = this.fallback(id);
      this.activeId = next === id ? null : next;
    }
    this.emitChange();
  }

  /** Lokale Vorhersage nach einem Befehl (fühlt sich schneller an). */
  patch(id, changes) {
    const state = this.states.get(id);
    if (!state) return;
    if ('position' in changes) state.position = changes.position;
    if ('playing' in changes) state.playing = changes.playing;
    state.receivedAt = this.now();
    this.emitChange();
  }

  isPlaying(id) {
    return Boolean(this.states.get(id)?.playing);
  }

  /** Aktueller Zustand inkl. hochgerechneter Position. */
  current() {
    if (!this.activeId) return null;
    const state = this.states.get(this.activeId);
    if (!state || isEmpty(state)) return null;
    let position = state.position;
    if (state.playing && state.duration) {
      position = Math.min(state.duration, position + (this.now() - state.receivedAt) / 1000);
    }
    return { ...state, id: this.activeId, position };
  }

  emitChange() {
    this.dispatchEvent(new Event('change'));
  }
}

function isEmpty(state) {
  return !state.title && !state.playing;
}
