import { useEffect, useState } from "react";
import {
  CollabProvider,
  colorForName,
  ConnectionStatus,
} from "../lib/collabProvider";
import { WS_BASE, getToken, getStoredUser } from "../lib/api";

export function useCollab(documentId: string) {
  const [provider, setProvider] = useState<CollabProvider | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [peers, setPeers] = useState<Map<number, Record<string, unknown>>>(
    new Map()
  );

  useEffect(() => {
    const token = getToken();
    const user = getStoredUser();

    if (!token || !user) return;

    const p = new CollabProvider({
      documentId,
      token,
      wsUrl: WS_BASE,
      user: {
        name: user.name,
        color: colorForName(user.name),
      },
      onStatusChange: setStatus,
      onPeersChange: setPeers,
    });

    setProvider(p);

    return () => {
      p.destroy();
    };
  }, [documentId]);

  return {
    provider,
    doc: provider?.doc ?? null,
    awareness: provider?.awareness ?? null,
    status,
    peers,
  };
}