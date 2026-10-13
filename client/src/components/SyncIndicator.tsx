import type { ConnectionStatus } from '../lib/collabProvider';

const LABELS: Record<ConnectionStatus, string> = {
  connected: 'Live',
  connecting: 'Connecting…',
  disconnected: 'Offline — changes are saved locally',
};

export default function SyncIndicator({ status, synced }: { status: ConnectionStatus; synced: boolean }) {
  const label = status === 'connected' && !synced ? 'Syncing…' : LABELS[status];
  return (
    <div className={`sync-indicator sync-${status}`} role="status" aria-live="polite">
      <span className="sync-dot" />
      <span>{label}</span>
    </div>
  );
}
