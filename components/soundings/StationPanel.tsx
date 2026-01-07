'use client';

import { useEffect, useCallback } from 'react';
import { X, MapPin, Clock, Thermometer, Wind, Droplets, Zap } from 'lucide-react';
import { RAOBStation, AircraftAirport, SoundingResponse } from '@/lib/soundings/types';
import { SkewTLogP } from './SkewTLogP';
import { Hodograph } from './Hodograph';
import { DerivedParamsCard } from './DerivedParamsCard';

interface StationPanelProps {
  station: RAOBStation | null;
  airport: AircraftAirport | null;
  soundingData: SoundingResponse | null | undefined;
  soundingLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  selectedTime: '00Z' | '12Z';
  onDateChange: (date: string) => void;
  onTimeChange: (time: '00Z' | '12Z') => void;
}

export function StationPanel({
  station,
  airport,
  soundingData,
  soundingLoading,
  isOpen,
  onClose,
  selectedDate,
  selectedTime,
  onDateChange,
  onTimeChange,
}: StationPanelProps) {
  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  if (!isOpen) return null;

  const name = station?.name || airport?.name || 'Unknown';
  const location = station
    ? `${station.state} | ${station.icao || station.wmo_id}`
    : airport
    ? `${airport.city}, ${airport.state} | ${airport.icao}`
    : '';
  const lat = station?.lat || airport?.lat || 0;
  const lon = station?.lon || airport?.lon || 0;
  const elevation = station
    ? `${station.elevation_m}m MSL`
    : airport
    ? `${airport.elevation_ft}ft MSL`
    : '';

  const isRAOB = !!station;

  return (
    <div
      className="absolute top-0 right-0 h-full w-full md:w-[500px] lg:w-[600px] bg-mv-bg-secondary border-l border-white/10 shadow-2xl overflow-hidden z-10 animate-slide-in-right"
    >
      {/* Header */}
      <div className="sticky top-0 bg-mv-bg-secondary border-b border-white/10 p-4 z-10">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-mv-text-primary">{name}</h3>
            <p className="text-sm text-mv-text-muted">{location}</p>
            <div className="flex items-center gap-4 mt-1 text-xs text-mv-text-dimmed">
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {lat.toFixed(2)}°, {lon.toFixed(2)}°
              </span>
              <span>{elevation}</span>
              <span className={`px-2 py-0.5 rounded ${isRAOB ? 'bg-mv-accent-blue/20 text-mv-accent-blue' : 'bg-mv-accent-purple/20 text-mv-accent-purple'}`}>
                {isRAOB ? 'RAOB' : 'ACARS'}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/5 text-mv-text-muted hover:text-mv-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Time/Date Selector (RAOB only) */}
        {isRAOB && (
          <div className="flex gap-4 mt-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-mv-text-muted" />
              <div className="flex gap-1 bg-mv-bg-tertiary rounded-lg p-0.5">
                <button
                  onClick={() => onTimeChange('00Z')}
                  className={`px-3 py-1 text-sm rounded transition-all ${
                    selectedTime === '00Z'
                      ? 'bg-mv-accent-cyan text-white'
                      : 'text-mv-text-muted hover:text-mv-text-primary'
                  }`}
                >
                  00Z
                </button>
                <button
                  onClick={() => onTimeChange('12Z')}
                  className={`px-3 py-1 text-sm rounded transition-all ${
                    selectedTime === '12Z'
                      ? 'bg-mv-accent-cyan text-white'
                      : 'text-mv-text-muted hover:text-mv-text-primary'
                  }`}
                >
                  12Z
                </button>
              </div>
            </div>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => onDateChange(e.target.value)}
              className="bg-mv-bg-tertiary border border-white/10 rounded-lg px-3 py-1 text-sm text-mv-text-primary focus:outline-none focus:ring-1 focus:ring-mv-accent-blue"
            />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="overflow-y-auto h-[calc(100%-140px)] p-4 space-y-6">
        {soundingLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-mv-accent-blue border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-mv-text-muted">Loading sounding data...</p>
          </div>
        ) : !soundingData ? (
          <div className="text-center py-12">
            <p className="text-mv-text-muted">
              {isRAOB
                ? 'Select a date and time to view sounding data'
                : 'ACARS profiles coming soon...'}
            </p>
          </div>
        ) : (
          <>
            {/* Quick Stats */}
            <div className="grid grid-cols-4 gap-3">
              <StatBox
                icon={<Zap className="w-4 h-4" />}
                label="CAPE"
                value={`${Math.round(soundingData.derived.mucape)}`}
                unit="J/kg"
                color={soundingData.derived.mucape > 1000 ? 'text-red-400' : 'text-mv-text-primary'}
              />
              <StatBox
                icon={<Thermometer className="w-4 h-4" />}
                label="LI"
                value={soundingData.derived.li.toFixed(1)}
                color={soundingData.derived.li < -4 ? 'text-red-400' : 'text-mv-text-primary'}
              />
              <StatBox
                icon={<Wind className="w-4 h-4" />}
                label="0-6km"
                value={`${Math.round(soundingData.derived.shear_0_6km)}`}
                unit="kt"
                color={soundingData.derived.shear_0_6km > 40 ? 'text-orange-400' : 'text-mv-text-primary'}
              />
              <StatBox
                icon={<Droplets className="w-4 h-4" />}
                label="PWAT"
                value={soundingData.derived.pwat_in.toFixed(2)}
                unit="in"
              />
            </div>

            {/* Skew-T Diagram */}
            <div className="bg-mv-bg-tertiary rounded-xl p-4">
              <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
                Skew-T / Log-P
              </h4>
              <div className="aspect-square max-h-[400px] w-full">
                <SkewTLogP
                  levels={soundingData.sounding.levels}
                  derived={soundingData.derived}
                />
              </div>
            </div>

            {/* Hodograph */}
            <div className="bg-mv-bg-tertiary rounded-xl p-4">
              <h4 className="text-sm font-semibold text-mv-text-primary mb-3">
                Hodograph
              </h4>
              <div className="aspect-square max-h-[300px] w-full mx-auto">
                <Hodograph
                  levels={soundingData.sounding.levels}
                  derived={soundingData.derived}
                  surfaceHeight={soundingData.sounding.elevation_m}
                />
              </div>
            </div>

            {/* Derived Parameters */}
            <DerivedParamsCard derived={soundingData.derived} />
          </>
        )}
      </div>
    </div>
  );
}

function StatBox({
  icon,
  label,
  value,
  unit,
  color = 'text-mv-text-primary',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  color?: string;
}) {
  return (
    <div className="bg-mv-bg-tertiary rounded-lg p-3 text-center">
      <div className="flex items-center justify-center gap-1 text-mv-text-muted mb-1">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className={`text-lg font-bold ${color}`}>
        {value}
        {unit && <span className="text-xs font-normal text-mv-text-muted ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

export default StationPanel;
