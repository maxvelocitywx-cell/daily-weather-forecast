'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Clock, AlertTriangle, Zap } from 'lucide-react';
import HeadlineCard from './HeadlineCard';
import { HeadlinesRun } from '@/lib/headlines/types';

interface HeadlinesListProps {
  initialData?: HeadlinesRun | null;
}

export default function HeadlinesList({ initialData }: HeadlinesListProps) {
  const [data, setData] = useState<HeadlinesRun | null>(initialData || null);
  const [loading, setLoading] = useState(!initialData);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchHeadlines = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/headlines');
      if (!res.ok) throw new Error('Failed to fetch headlines');

      const result = await res.json();
      setData(result);
      setLastRefresh(new Date());
    } catch (err) {
      setError('Unable to load headlines. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const generateHeadlines = async () => {
    setGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/headlines/generate', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to generate headlines');

      const result = await res.json();
      if (result.run) {
        setData(result.run);
        setLastRefresh(new Date());
      }
    } catch (err) {
      setError('Unable to generate headlines. Please try again.');
      console.error(err);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!initialData) {
      fetchHeadlines();
    }

    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchHeadlines, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [initialData]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  };

  const getTimeAgo = (timestamp: string) => {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = now - then;

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    return formatTimestamp(timestamp);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <RefreshCw className="w-12 h-12 text-cyan-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-lg">Loading headlines...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <p className="text-gray-400 text-lg mb-4">{error}</p>
          <button
            onClick={fetchHeadlines}
            className="px-4 py-2 bg-cyan-500/20 text-cyan-400 rounded-lg border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!data || !data.headlines) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-400">No headlines available</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with timestamp */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-gray-500" />
          <div>
            <p className="text-sm text-gray-400">
              Last updated: <span className="text-white font-medium">{getTimeAgo(data.timestamp)}</span>
            </p>
            <p className="text-xs text-gray-600">{formatTimestamp(data.timestamp)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={generateHeadlines}
            disabled={generating || loading}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              bg-gradient-to-r from-amber-500/20 to-orange-500/20
              border border-amber-500/30 text-amber-400
              hover:from-amber-500/30 hover:to-orange-500/30 hover:border-amber-500/50
              transition-all disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            <Zap className={`w-4 h-4 ${generating ? 'animate-pulse' : ''}`} />
            {generating ? 'Generating...' : 'Generate Now'}
          </button>

          <button
            onClick={fetchHeadlines}
            disabled={loading}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
              bg-white/5 border border-white/10 text-gray-300
              hover:bg-white/10 hover:border-white/20 transition-all
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Headlines grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {data.headlines.map((headline, index) => (
          <HeadlineCard key={index} headline={headline} rank={index + 1} />
        ))}
      </div>

      {/* Footer */}
      {data.facts_summary && (
        <div className="text-center text-xs text-gray-600 mt-8 pt-4 border-t border-white/5">
          Data sources: {data.facts_summary}
        </div>
      )}
    </div>
  );
}
