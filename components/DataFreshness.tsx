'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import clsx from 'clsx';

interface DataFreshnessProps {
  lastUpdated: string | Date | null;
  isLoading?: boolean;
  onRefresh?: () => void;
}

export function DataFreshness({
  lastUpdated,
  isLoading,
  onRefresh,
}: DataFreshnessProps) {
  const [timeAgo, setTimeAgo] = useState<string>('');

  useEffect(() => {
    if (!lastUpdated) return;

    const updateTimeAgo = () => {
      const date = typeof lastUpdated === 'string' ? new Date(lastUpdated) : lastUpdated;
      setTimeAgo(formatDistanceToNow(date, { addSuffix: true }));
    };

    updateTimeAgo();
    const interval = setInterval(updateTimeAgo, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [lastUpdated]);

  return (
    <div className="flex items-center gap-2 text-xs text-mv-text-muted">
      <span
        className={clsx(
          'w-2 h-2 rounded-full',
          isLoading ? 'bg-yellow-500 animate-pulse' : 'bg-emerald-500'
        )}
      />
      <span>
        {isLoading ? 'Updating...' : timeAgo ? `Updated ${timeAgo}` : 'Loading...'}
      </span>
      {onRefresh && !isLoading && (
        <button
          onClick={onRefresh}
          className="hover:text-mv-text-primary transition-colors"
          title="Refresh data"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

export function DataSourceIndicator({
  sources,
}: {
  sources: Array<{
    name: string;
    status: 'online' | 'offline' | 'degraded';
  }>;
}) {
  const statusColors = {
    online: 'bg-emerald-500',
    offline: 'bg-red-500',
    degraded: 'bg-yellow-500',
  };

  return (
    <div className="flex items-center gap-3">
      {sources.map((source) => (
        <div key={source.name} className="flex items-center gap-1.5">
          <span className={clsx('w-1.5 h-1.5 rounded-full', statusColors[source.status])} />
          <span className="text-xs text-mv-text-muted">{source.name}</span>
        </div>
      ))}
    </div>
  );
}
