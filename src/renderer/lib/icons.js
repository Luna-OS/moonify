// Schlanke Strich-Icons (24×24), passend zum Mond-Theme.
const wrap = (body, extra = '') =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" ${extra}>${body}</svg>`;

export const icons = {
  home: wrap('<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z"/>'),
  plus: wrap('<path d="M12 5v14M5 12h14"/>'),
  search: wrap('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  back: wrap('<path d="M15 5l-7 7 7 7"/>'),
  forward: wrap('<path d="M9 5l7 7-7 7"/>'),
  reload: wrap('<path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5V9h-4.5"/>'),
  close: wrap('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: wrap('<path d="M8 5.5v13l11-6.5z" class="fill"/>'),
  pause: wrap('<path d="M8 5h3v14H8zM13 5h3v14h-3z" class="fill"/>'),
  next: wrap('<path d="M6 5.5v13l9-6.5z" class="fill"/><path d="M18 5v14"/>'),
  prev: wrap('<path d="M18 5.5v13l-9-6.5z" class="fill"/><path d="M6 5v14"/>'),
  volume: wrap('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" class="fill"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  muted: wrap('<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" class="fill"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  open: wrap('<path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/>'),
  check: wrap('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  sparkle: wrap('<path d="M12 3c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z" class="fill"/>'),
  note: wrap('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
};
