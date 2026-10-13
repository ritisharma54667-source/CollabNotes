/** The API sends ISO-8601 UTC timestamps; zone-less "YYYY-MM-DD HH:MM:SS" strings are also treated as UTC. */
export function parseServerDate(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
}

export function timeAgo(value: string, now = Date.now()): string {
  const diff = Math.max(0, now - parseServerDate(value).getTime());
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return parseServerDate(value).toLocaleDateString();
}
