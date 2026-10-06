/** Vergleicht Versionen wie „0.2.0“ oder „v1.10.3“: <0, 0 oder >0. */
export function compareVersions(a, b) {
  const parts = (v) =>
    String(v || '')
      .trim()
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff) return diff;
  }
  return 0;
}
