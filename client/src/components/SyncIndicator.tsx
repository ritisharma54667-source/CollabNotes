import type { ConnectionStatus } from '../lib/collabProvider';

interface Props {
  status: ConnectionStatus;
}

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connecting…',
  connected: 'Live',
  disconnected: 'Reconnecting…',
};

export default function SyncIndicator({ status }: Props) {
  return (
    <span className={`sync-indicator sync-${status}`}>
      <span className="sync-dot" />
      {LABELS[status]}
    </span>
  );
}
