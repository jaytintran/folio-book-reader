import {WifiOff} from 'lucide-react';
import React from 'react';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-40 flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--border-strong)] bg-[var(--bg-elevated)] text-xs font-medium text-[var(--text-primary)] shadow-md"
    >
      <WifiOff className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
      <span>Offline mode — local library active</span>
    </div>
  );
};
