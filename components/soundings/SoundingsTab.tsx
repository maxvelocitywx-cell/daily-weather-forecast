'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useSoundingStations, useSounding } from '@/hooks/useSoundings';
import { RAOBStation, AircraftAirport } from '@/lib/soundings/types';
import { StationPanel } from './StationPanel';

// Dynamic import for map to avoid SSR issues
const SoundingsMap = dynamic(() => import('./SoundingsMapClient'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-mv-bg-tertiary animate-pulse flex items-center justify-center">
      <span className="text-mv-text-muted">Loading map...</span>
    </div>
  ),
});

type SourceType = 'raob' | 'acars' | 'all';

export function SoundingsTab() {
  // State
  const [selectedStation, setSelectedStation] = useState<RAOBStation | null>(null);
  const [selectedAirport, setSelectedAirport] = useState<AircraftAirport | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<'00Z' | '12Z'>('12Z');
  const [sourceFilter, setSourceFilter] = useState<SourceType>('all');
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // Data fetching
  const { data: stationsData, isLoading: stationsLoading } = useSoundingStations();

  // Fetch sounding when station and time are selected
  const { data: soundingData, isLoading: soundingLoading } = useSounding(
    selectedStation?.id || null,
    selectedDate || undefined,
    selectedTime
  );

  // Handlers
  const handleStationSelect = useCallback((station: RAOBStation) => {
    setSelectedStation(station);
    setSelectedAirport(null);
    setIsPanelOpen(true);
  }, []);

  const handleAirportSelect = useCallback((airport: AircraftAirport) => {
    setSelectedAirport(airport);
    setSelectedStation(null);
    setIsPanelOpen(true);
  }, []);

  const handleClosePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  const handleDateChange = useCallback((date: string) => {
    setSelectedDate(date);
  }, []);

  const handleTimeChange = useCallback((time: '00Z' | '12Z') => {
    setSelectedTime(time);
  }, []);

  // Get default date (today)
  const getDefaultDate = () => {
    const now = new Date();
    return now.toISOString().split('T')[0];
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-mv-bg-secondary rounded-xl border border-white/5 p-4">
        <h2 className="text-xl font-bold text-mv-text-primary">
          Weather Soundings
        </h2>
        <p className="text-sm text-mv-text-muted mt-1">
          Upper air observations with Skew-T diagrams, hodographs, and derived severe weather parameters
        </p>
      </div>

      {/* Controls Bar */}
      <div className="bg-mv-bg-secondary rounded-xl border border-white/5 p-4">
        <div className="flex flex-wrap gap-4 items-center">
          {/* Source Filter */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-mv-text-muted">Source:</span>
            <div className="flex gap-1 bg-mv-bg-tertiary rounded-lg p-1">
              <button
                onClick={() => setSourceFilter('all')}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  sourceFilter === 'all'
                    ? 'bg-mv-accent-blue text-white'
                    : 'text-mv-text-muted hover:text-mv-text-primary'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setSourceFilter('raob')}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  sourceFilter === 'raob'
                    ? 'bg-mv-accent-blue text-white'
                    : 'text-mv-text-muted hover:text-mv-text-primary'
                }`}
              >
                RAOB
              </button>
              <button
                onClick={() => setSourceFilter('acars')}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  sourceFilter === 'acars'
                    ? 'bg-mv-accent-blue text-white'
                    : 'text-mv-text-muted hover:text-mv-text-primary'
                }`}
              >
                ACARS
              </button>
            </div>
          </div>

          {/* Time Selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-mv-text-muted">Time:</span>
            <div className="flex gap-1 bg-mv-bg-tertiary rounded-lg p-1">
              <button
                onClick={() => setSelectedTime('00Z')}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  selectedTime === '00Z'
                    ? 'bg-mv-accent-cyan text-white'
                    : 'text-mv-text-muted hover:text-mv-text-primary'
                }`}
              >
                00Z
              </button>
              <button
                onClick={() => setSelectedTime('12Z')}
                className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                  selectedTime === '12Z'
                    ? 'bg-mv-accent-cyan text-white'
                    : 'text-mv-text-muted hover:text-mv-text-primary'
                }`}
              >
                12Z
              </button>
            </div>
          </div>

          {/* Date Picker */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-mv-text-muted">Date:</span>
            <input
              type="date"
              value={selectedDate || getDefaultDate()}
              onChange={(e) => handleDateChange(e.target.value)}
              max={getDefaultDate()}
              className="bg-mv-bg-tertiary border border-white/10 rounded-lg px-3 py-1.5 text-sm text-mv-text-primary focus:outline-none focus:ring-2 focus:ring-mv-accent-blue"
            />
          </div>

          {/* Station Count */}
          {stationsData && (
            <div className="ml-auto text-sm text-mv-text-muted">
              {sourceFilter === 'all' || sourceFilter === 'raob' ? (
                <span>{stationsData.raob_stations.length} RAOB stations</span>
              ) : null}
              {sourceFilter === 'all' && <span className="mx-2">|</span>}
              {sourceFilter === 'all' || sourceFilter === 'acars' ? (
                <span>{stationsData.acars_airports.length} ACARS airports</span>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Map Container */}
      <div className="bg-mv-bg-secondary rounded-xl border border-white/5 overflow-hidden">
        <div className="h-[65vh] min-h-[500px] relative">
          {stationsLoading ? (
            <div className="w-full h-full flex items-center justify-center bg-mv-bg-tertiary">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-mv-accent-blue border-t-transparent rounded-full animate-spin" />
                <span className="text-mv-text-muted">Loading stations...</span>
              </div>
            </div>
          ) : (
            <SoundingsMap
              raobStations={
                sourceFilter === 'acars'
                  ? []
                  : stationsData?.raob_stations || []
              }
              acarsAirports={
                sourceFilter === 'raob'
                  ? []
                  : stationsData?.acars_airports || []
              }
              selectedStation={selectedStation}
              selectedAirport={selectedAirport}
              onStationSelect={handleStationSelect}
              onAirportSelect={handleAirportSelect}
            />
          )}

          {/* Station Panel (slides in from right) */}
          <StationPanel
            station={selectedStation}
            airport={selectedAirport}
            soundingData={soundingData}
            soundingLoading={soundingLoading}
            isOpen={isPanelOpen}
            onClose={handleClosePanel}
            selectedDate={selectedDate || getDefaultDate()}
            selectedTime={selectedTime}
            onDateChange={handleDateChange}
            onTimeChange={handleTimeChange}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="bg-mv-bg-secondary rounded-xl border border-white/5 p-4">
        <div className="flex flex-wrap gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-mv-accent-blue border-2 border-white" />
            <span className="text-mv-text-muted">RAOB Station (Radiosonde)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-mv-accent-purple border-2 border-white" />
            <span className="text-mv-text-muted">ACARS Airport (Aircraft)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-mv-accent-cyan border-2 border-white ring-2 ring-mv-accent-cyan ring-opacity-50" />
            <span className="text-mv-text-muted">Selected</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SoundingsTab;
