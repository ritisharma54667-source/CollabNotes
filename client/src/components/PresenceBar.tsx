import type { PresenceUser } from '../lib/collabProvider';
import { initials } from '../lib/colors';

export default function PresenceBar({ users }: { users: PresenceUser[] }) {
  const others = users.filter((u) => !u.isSelf);
  if (others.length === 0) return <span className="presence-solo">Only you</span>;
  return (
    <div className="presence-bar" aria-label={`${others.length} other ${others.length === 1 ? 'person' : 'people'} here`}>
      {others.slice(0, 5).map((u) => (
        <span key={u.clientId} className="presence-avatar" style={{ background: u.color }} title={u.name}>
          {initials(u.name)}
        </span>
      ))}
      {others.length > 5 && <span className="presence-solo">+{others.length - 5}</span>}
    </div>
  );
}
