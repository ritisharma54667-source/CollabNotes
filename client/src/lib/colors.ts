export const USER_COLORS = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#818cf8', '#c084fc', '#f472b6'];

/** Stable color per user name, so a person looks the same across documents and sessions. */
export function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '?';
