'use client';

import { useEffect, useState, useCallback } from 'react';
import AlertCard from './AlertCard';

interface AlertData {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  effective: string;
  expires: string;
  ends: string | null;
  areaDesc: string;
  states: string[];
  populationFormatted: string;
  population: {
    total: number;
    totalFormatted: string;
    byState: Record<string, number>;
    byStateFormatted: Record<string, string>;
    topCounties: Array<{ fips: string; name: string; population: number }>;
  };
  score: number;
  hasGeometry: boolean;
  geometry?: {
    type: string;
    coordinates: number[][][] | number[][][][];
  } | null;
  sender: string;
}

interface AlertsResponse {
  updated: string;
  totalActive: number;
  alerts: AlertData[];
}

export default function WeatherAlerts() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchAlerts = useCallback(async () => {
    try {
      const response = await fetch('/api/alerts');
      if (!response.ok) {
        throw new Error('Failed to fetch alerts');
      }
      const result = await response.json();
      setData(result);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();

    // Refresh every 60 seconds
    const interval = setInterval(fetchAlerts, 60000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const handleViewMap = (alert: AlertData) => {
    // For now, just log - can be extended to show a modal with map
    console.log('View map for:', alert.id, alert.geometry);
    // TODO: Implement map modal
  };

  if (loading) {
    return (
      <section className="w-full">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
                <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-transparent border-b-purple-500/50 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
              </div>
              <p className="text-gray-400 text-sm animate-pulse">Loading weather alerts...</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="w-full">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <p className="text-red-400 font-medium mb-2">Failed to load alerts</p>
              <p className="text-gray-500 text-sm mb-4">{error}</p>
              <button
                onClick={fetchAlerts}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 rounded-lg border border-white/10 transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-950/5 to-transparent pointer-events-none" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto px-4 py-12 relative z-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="relative">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping opacity-75" />
              </div>
              <span className="text-xs font-medium uppercase tracking-widest text-red-400">Live</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              USA Weather Alerts
            </h2>
            <p className="text-gray-400 mt-2">
              Top {data?.alerts.length || 0} alerts ranked by severity and affected population
            </p>
          </div>

          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{data?.totalActive.toLocaleString()} active alerts nationwide</span>
            </div>
            {lastUpdated && (
              <div className="text-xs text-gray-600">
                Updated {lastUpdated.toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        {/* No alerts state */}
        {data?.alerts.length === 0 && (
          <div className="flex items-center justify-center min-h-[300px]">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-green-500/10 flex items-center justify-center">
                <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-xl text-gray-300 font-medium mb-2">All Clear</p>
              <p className="text-gray-500">No significant weather alerts at this time</p>
            </div>
          </div>
        )}

        {/* Alerts grid */}
        {data && data.alerts.length > 0 && (
          <div className="grid gap-4 sm:gap-6">
            {data.alerts.map((alert, index) => (
              <div
                key={alert.id}
                className="animate-fadeIn"
                style={{ animationDelay: `${index * 100}ms` }}
              >
                <AlertCard alert={alert} onViewMap={handleViewMap} />
              </div>
            ))}
          </div>
        )}

        {/* Footer note */}
        <div className="mt-8 pt-6 border-t border-white/5 text-center">
          <p className="text-xs text-gray-600">
            Data sourced from the National Weather Service API. Alerts refresh automatically every 60 seconds.
          </p>
        </div>
      </div>
    </section>
  );
}
