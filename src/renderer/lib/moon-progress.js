import { formatTime } from './format.js';
import { moonSvg, progressToLit, updateMoon } from './moon.js';

/**
 * Fortschrittsleiste, deren Regler ein Mond ist.
 * Der Mond „wächst“ mit dem Song: Sichel am Anfang, Vollmond am Ende.
 */
export class MoonProgress {
  constructor(root, { onSeek } = {}) {
    this.root = root;
    this.onSeek = onSeek;
    this.position = 0;
    this.duration = 0;
    this.disabled = true;
    this.dragging = false;
    this.dragValue = 0;

    root.classList.add('moon-progress');
    root.setAttribute('role', 'slider');
    root.setAttribute('tabindex', '0');
    root.setAttribute('aria-label', 'Songposition');
    root.setAttribute('aria-valuemin', '0');
    root.innerHTML = `
      <div class="mp-track"><div class="mp-fill"></div></div>
      <div class="mp-thumb">${moonSvg({ lit: progressToLit(0) })}</div>
      <div class="mp-tooltip" aria-hidden="true">0:00</div>`;
    this.fill = root.querySelector('.mp-fill');
    this.thumb = root.querySelector('.mp-thumb');
    this.moon = this.thumb.querySelector('svg');
    this.tooltip = root.querySelector('.mp-tooltip');

    root.addEventListener('pointerdown', (e) => this.pointerDown(e));
    root.addEventListener('pointermove', (e) => this.pointerMove(e));
    root.addEventListener('pointerup', (e) => this.pointerUp(e));
    root.addEventListener('pointercancel', () => this.cancelDrag());
    root.addEventListener('keydown', (e) => this.keyDown(e));
    this.render();
  }

  set({ position = 0, duration = 0, disabled = false }) {
    this.position = position;
    this.duration = duration;
    this.disabled = disabled || !duration;
    this.render();
  }

  valueAt(clientX) {
    const rect = this.root.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * this.duration;
  }

  pointerDown(event) {
    if (this.disabled || event.button !== 0) return;
    this.dragging = true;
    this.root.setPointerCapture(event.pointerId);
    this.root.classList.add('dragging');
    this.dragValue = this.valueAt(event.clientX);
    this.render();
  }

  pointerMove(event) {
    if (this.disabled) return;
    const value = this.valueAt(event.clientX);
    const rect = this.root.getBoundingClientRect();
    this.tooltip.textContent = formatTime(value);
    this.tooltip.style.left = `${Math.min(rect.width, Math.max(0, event.clientX - rect.left))}px`;
    if (this.dragging) {
      this.dragValue = value;
      this.render();
    }
  }

  pointerUp(event) {
    if (!this.dragging) return;
    this.dragValue = this.valueAt(event.clientX);
    this.commit(this.dragValue);
    this.cancelDrag();
  }

  cancelDrag() {
    this.dragging = false;
    this.root.classList.remove('dragging');
    this.render();
  }

  keyDown(event) {
    if (this.disabled) return;
    const steps = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 30, PageDown: -30 };
    let target = null;
    if (event.key in steps) target = this.position + steps[event.key];
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = this.duration - 1;
    if (target === null) return;
    event.preventDefault();
    this.commit(Math.min(this.duration, Math.max(0, target)));
  }

  commit(value) {
    this.position = value;
    this.render();
    this.onSeek?.(value);
  }

  render() {
    const value = this.dragging ? this.dragValue : this.position;
    const progress = this.duration ? Math.min(1, Math.max(0, value / this.duration)) : 0;
    const percent = `${(progress * 100).toFixed(3)}%`;
    this.fill.style.width = percent;
    this.thumb.style.left = percent;
    updateMoon(this.moon, progressToLit(progress), true);
    this.root.classList.toggle('disabled', this.disabled);
    this.root.setAttribute('aria-disabled', String(this.disabled));
    this.root.setAttribute('aria-valuemax', String(Math.round(this.duration)));
    this.root.setAttribute('aria-valuenow', String(Math.round(value)));
    this.root.setAttribute('aria-valuetext', `${formatTime(value)} von ${formatTime(this.duration)}`);
  }
}
