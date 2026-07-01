import type { AwarenessState } from 'y-protocols/awareness';

interface Props {
  peers: Map<number, AwarenessState>;
}

export default function PresenceBar({ peers }: Props) {
  const users: { name: string; color: string }[] = [];
  peers.forEach((state) => {
    const user = state.user as { name: string; color: string } | undefined;
    if (user) users.push(user);
  });

  // Deduplicate by name
  const unique = users.filter((u, i, arr) => arr.findIndex((x) => x.name === u.name) === i);

  return (
    <div className="presence-bar">
      {unique.map((u) => (
        <span key={u.name} className="presence-avatar" style={{ background: u.color }} title={u.name}>
          {u.name.charAt(0).toUpperCase()}
        </span>
      ))}
      {unique.length === 0 && <span className="presence-solo">Only you</span>}
    </div>
  );
}
