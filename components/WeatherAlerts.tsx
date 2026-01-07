'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import Top5AlertCard, { AlertData } from './alerts/Top5AlertCard';
import VirtualizedAlertList from './alerts/VirtualizedAlertList';
import { AlertListItemData } from './alerts/AlertListItem';
import { AlertForMap } from './alerts/AlertsMapClient';

// Dynamic import for map to avoid SSR issues
const AlertsMapClient = dynamic(() => import('./alerts/AlertsMapClient'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[480px] rounded-xl bg-mv-bg-secondary border border-white/10 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
        <span className="text-sm text-mv-text-muted">Loading map...</span>
      </div>
    </div>
  )
});

interface AlertsResponse {
  updated: string;
  totalActive: number;
  totalRaw: number;
  top5: AlertData[];
  other: AlertData[];
  alerts: AlertData[];
}

export default function WeatherAlerts() {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [hoveredAlertId, setHoveredAlertId] = useState<string | null>(null);

  // Refs for scrolling
  const top5CardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const listContainerRef = useRef<HTMLDivElement>(null);

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
    const interval = setInterval(fetchAlerts, 60000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  // Convert alerts for map display
  const mapAlerts: AlertForMap[] = useMemo(() => {
    if (!data) return [];

    const top5WithRank = data.top5.map((alert, idx) => ({
      id: alert.id,
      event: alert.event,
      severity: alert.severity,
      expires: alert.expires,
      areaDesc: alert.areaDesc,
      hasGeometry: alert.hasGeometry,
      geometry: alert.geometry || null,
      states: alert.states,
      isTop5: true,
      rank: idx + 1
    }));

    const otherAlerts = data.other.map((alert, idx) => ({
      id: alert.id,
      event: alert.event,
      severity: alert.severity,
      expires: alert.expires,
      areaDesc: alert.areaDesc,
      hasGeometry: alert.hasGeometry,
      geometry: alert.geometry || null,
      states: alert.states,
      isTop5: false,
      rank: idx + 6
    }));

    return [...top5WithRank, ...otherAlerts];
  }, [data]);

  // Convert other alerts for list display
  const listAlerts: AlertListItemData[] = useMemo(() => {
    if (!data) return [];
    return data.other.map(alert => ({
      id: alert.id,
      event: alert.event,
      severity: alert.severity,
      expires: alert.expires,
      areaDesc: alert.areaDesc,
      states: alert.states,
      hasGeometry: alert.hasGeometry
    }));
  }, [data]);

  // Handle alert selection
  const handleAlertSelect = useCallback((alertId: string | null) => {
    setSelectedAlertId(alertId);

    if (alertId) {
      // Scroll top 5 card into view if it exists
      const cardRef = top5CardRefs.current.get(alertId);
      if (cardRef) {
        cardRef.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, []);

  // Handle alert hover
  const handleAlertHover = useCallback((alertId: string | null) => {
    setHoveredAlertId(alertId);
  }, []);

  // Handle view on map click from Top5 card
  const handleViewOnMap = useCallback((alertId: string) => {
    setSelectedAlertId(alertId);
    // Map will auto-fly to this alert
  }, []);

  if (loading) {
    return (
      <section className="w-full">
        <div className="flex items-center justify-center min-h-[500px]">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="w-12 h-12 rounded-full border-2 border-cyan-500/30 border-t-cyan-500 animate-spin" />
              <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-transparent border-b-purple-500/50 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
            </div>
            <p className="text-gray-400 text-sm animate-pulse">Loading weather alerts...</p>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="w-full">
        <div className="flex items-center justify-center min-h-[500px]">
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
      </section>
    );
  }

  const totalAlerts = (data?.top5.length || 0) + (data?.other.length || 0);

  return (
    <section className="w-full relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyan-950/5 to-transparent pointer-events-none" />
      <div className="absolute top-1/4 left-1/4 w-[600px] h-[600px] bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="relative">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <div className="absolute inset-0 w-3 h-3 bg-red-500 rounded-full animate-ping opacity-75" />
              </div>
              <span className="text-xs font-medium uppercase tracking-widest text-red-400">Live</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
              USA Weather Alerts
            </h2>
            <p className="text-gray-400 mt-1 text-sm">
              {totalAlerts} active alerts ranked by severity and population impact
            </p>
          </div>

          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{data?.totalRaw.toLocaleString() || 0} raw alerts from NWS</span>
            </div>
            {lastUpdated && (
              <div className="text-xs text-gray-600">
                Updated {lastUpdated.toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        {/* No alerts state */}
        {totalAlerts === 0 && (
          <div className="flex items-center justify-center min-h-[400px]">
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

        {/* Main content - Two column layout */}
        {totalAlerts > 0 && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left column - Map + Top 5 */}
            <div className="flex-1 lg:w-[65%] space-y-6">
              {/* Map */}
              <AlertsMapClient
                alerts={mapAlerts}
                selectedAlertId={selectedAlertId}
                onAlertSelect={handleAlertSelect}
                onAlertHover={handleAlertHover}
                height={480}
              />

              {/* Top 5 Section */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-xs font-bold text-white">5</span>
                  Top Priority Alerts
                </h3>
                <div className="space-y-4">
                  {data?.top5.map((alert, index) => (
                    <div
                      key={alert.id}
                      ref={(el) => {
                        if (el) top5CardRefs.current.set(alert.id, el);
                      }}
                      className="animate-fadeIn"
                      style={{ animationDelay: `${index * 100}ms` }}
                    >
                      <Top5AlertCard
                        alert={alert}
                        rank={index + 1}
                        isSelected={selectedAlertId === alert.id}
                        isHovered={hoveredAlertId === alert.id}
                        onSelect={() => handleAlertSelect(alert.id)}
                        onViewMap={() => handleViewOnMap(alert.id)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column - All Other Alerts */}
            <div className="lg:w-[35%] lg:min-w-[320px]">
              <div
                ref={listContainerRef}
                className="sticky top-4 bg-mv-bg-secondary/80 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden"
              >
                {/* Header */}
                <div className="px-4 py-3 border-b border-white/10">
                  <h3 className="text-sm font-semibold text-white">
                    All Other Alerts
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {listAlerts.length} additional alerts
                  </p>
                </div>

                {/* Virtualized list */}
                <div className="h-[calc(100vh-280px)] min-h-[400px] max-h-[800px]">
                  <VirtualizedAlertList
                    alerts={listAlerts}
                    selectedAlertId={selectedAlertId}
                    hoveredAlertId={hoveredAlertId}
                    onAlertSelect={handleAlertSelect}
                    onAlertHover={handleAlertHover}
                    height={Math.min(800, Math.max(400, typeof window !== 'undefined' ? window.innerHeight - 280 : 600))}
                  />
                </div>
              </div>
            </div>
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
