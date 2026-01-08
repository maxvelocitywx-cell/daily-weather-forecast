'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Clock, AlertTriangle, Zap, Database, CheckCircle2 } from 'lucide-react';
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

  // Get unique regions from all headlines
  const getUniqueRegions = () => {
    if (!data?.headlines) return [];
    const regions = new Set<string>();
    for (const headline of data.headlines) {
      if (headline.regions) {
        for (const region of headline.regions) {
          regions.add(region);
        }
      }
    }
    return Array.from(regions).slice(0, 8);
  };

  // Get topic distribution
  const getTopicDistribution = () => {
    if (!data?.headlines) return {};
    const topics: Record<string, number> = {};
    for (const headline of data.headlines) {
      topics[headline.topic] = (topics[headline.topic] || 0) + 1;
    }
    return topics;
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

  const uniqueRegions = getUniqueRegions();
  const topicDist = getTopicDistribution();
  const verifiedCount = data.headlines.filter(h => h.fact_ids && h.fact_ids.length > 0).length;

  return (
    <div className="space-y-6">
      {/* Header with timestamp and stats */}
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

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
        {/* Verified indicator */}
        <div className="flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span className="text-sm text-gray-300">
            <span className="text-emerald-400 font-medium">{verifiedCount}/10</span> verified
          </span>
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-white/10" />

        {/* Topics covered */}
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-cyan-400" />
          <span className="text-sm text-gray-300">
            {Object.keys(topicDist).length} topics
          </span>
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-white/10" />

        {/* Regions */}
        {uniqueRegions.length > 0 && (
          <div className="flex-1 flex items-center gap-2 overflow-hidden">
            <span className="text-sm text-gray-500 shrink-0">Regions:</span>
            <div className="flex flex-wrap gap-1">
              {uniqueRegions.slice(0, 5).map((region, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 bg-white/5 rounded text-xs text-gray-400 border border-white/5"
                >
                  {region}
                </span>
              ))}
              {uniqueRegions.length > 5 && (
                <span className="text-xs text-gray-500">+{uniqueRegions.length - 5} more</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Headlines grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {data.headlines.map((headline, index) => (
          <HeadlineCard key={headline.id || index} headline={headline} rank={index + 1} />
        ))}
      </div>

      {/* Footer */}
      {data.facts_summary && (
        <div className="mt-8 pt-4 border-t border-white/5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="text-xs text-gray-600">
              <span className="text-gray-500">Data sources:</span> {data.facts_summary}
            </div>
            {data.validation && (
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                <span className="text-gray-500">
                  {data.validation.facts_used} facts used
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
