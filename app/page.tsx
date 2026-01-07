'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { RegionId } from '@/lib/types';
import { useWeatherData, useRegionCities } from '@/hooks/useWeather';
import { Header, Footer } from '@/components/UpdateBar';
import { UpdateBar } from '@/components/UpdateBar';
import { NationalSummary, NationalSummarySkeleton } from '@/components/NationalSummary';
import { WeatherMap, MapPlaceholder } from '@/components/WeatherMap';
import { RegionList } from '@/components/RegionList';
import { National7DayTable } from '@/components/National7DayTable';
import { NDFDRecordsMap } from '@/components/NDFDRecordsMap';
import WeatherAlerts from '@/components/WeatherAlerts';
import { SoundingsTab } from '@/components/soundings/SoundingsTab';
import HeadlinesList from '@/components/headlines/HeadlinesList';

type TabId = 'headlines' | 'alerts' | 'forecast' | 'records' | 'soundings';

export default function HomePage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabId>('alerts');
  const [selectedDay, setSelectedDay] = useState(1);
  const [selectedRegion, setSelectedRegion] = useState<RegionId | null>(null);

  const { data: weatherData, isLoading: weatherLoading, mutate } = useWeatherData();
  const { data: citiesData, isLoading: citiesLoading } = useRegionCities();

  const handleRefresh = useCallback(() => {
    mutate();
  }, [mutate]);

  const handleRegionSelect = useCallback((regionId: RegionId | null) => {
    setSelectedRegion(regionId);
  }, []);

  // Navigate to city detail page when clicking on a city in the list
  const handleCitySelect = useCallback((cityId: string) => {
    const dayKey = `day${selectedDay}`;
    router.push(`/city/${cityId}?day=${dayKey}`);
  }, [router, selectedDay]);

  const isLoading = weatherLoading || citiesLoading;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <UpdateBar
        lastUpdated={weatherData?.fetchedAt || null}
        isLoading={isLoading}
        onRefresh={handleRefresh}
      />

      {/* Tab Navigation */}
      <div className="max-w-7xl mx-auto px-4 pt-4">
        <div className="flex flex-wrap gap-2 bg-mv-bg-secondary rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('headlines')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
              activeTab === 'headlines'
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md'
                : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
            }`}
          >
            <span className="text-base">📰</span>
            Headlines
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
              activeTab === 'alerts'
                ? 'bg-red-500 text-white shadow-md'
                : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            Active Alerts
          </button>
          <button
            onClick={() => setActiveTab('forecast')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === 'forecast'
                ? 'bg-mv-accent-blue text-white shadow-md'
                : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
            }`}
          >
            Regional Forecast
          </button>
          <button
            onClick={() => setActiveTab('records')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === 'records'
                ? 'bg-mv-accent-blue text-white shadow-md'
                : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
            }`}
          >
            Temperature Records
          </button>
          <button
            onClick={() => setActiveTab('soundings')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
              activeTab === 'soundings'
                ? 'bg-mv-accent-purple text-white shadow-md'
                : 'text-mv-text-muted hover:text-mv-text-primary hover:bg-white/5'
            }`}
          >
            Soundings
          </button>
        </div>
      </div>

      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full">
        {activeTab === 'headlines' ? (
          /* Headlines Tab */
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h1 className="text-3xl md:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-orange-500 to-red-500">
                Top 10 Weather Headlines
              </h1>
              <p className="text-gray-400 mt-2">
                Real-time weather reports and forecasts across the United States
              </p>
            </div>
            <HeadlinesList />
          </div>
        ) : activeTab === 'alerts' ? (
          <WeatherAlerts />
        ) : activeTab === 'forecast' ? (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left column - National Summary and Map */}
              <div className="lg:col-span-2 space-y-6">
                {/* National Summary */}
                {isLoading || !weatherData ? (
                  <NationalSummarySkeleton />
                ) : (
                  <NationalSummary
                    regionRisks={weatherData.regions}
                    national={weatherData.national}
                    selectedDay={selectedDay}
                    onDayChange={setSelectedDay}
                  />
                )}

                {/* Map - responsive height: 50-60vh mobile, 70-85vh desktop */}
                <div className="bg-mv-bg-secondary rounded-xl border border-white/5 overflow-hidden">
                  <div className="p-4 border-b border-white/5">
                    <h3 className="text-lg font-semibold text-mv-text-primary">
                      Regional Risk Map
                    </h3>
                    <p className="text-sm text-mv-text-muted mt-1">
                      Click on a region or city for details
                    </p>
                  </div>
                  <div className="h-[55vh] lg:h-[75vh] min-h-[400px] max-h-[900px]">
                    <WeatherMap
                      regionRisks={weatherData?.regions || {}}
                      cities={citiesData || []}
                      selectedRegion={selectedRegion}
                      selectedDay={selectedDay}
                      onRegionSelect={handleRegionSelect}
                      onDayChange={setSelectedDay}
                    />
                  </div>
                </div>
              </div>

              {/* Right column - Region List */}
              <div className="lg:col-span-1">
                <RegionList
                  regionRisks={weatherData?.regions || {}}
                  cities={citiesData || []}
                  selectedDay={selectedDay}
                  onDayChange={setSelectedDay}
                  onCitySelect={handleCitySelect}
                  onRegionSelect={handleRegionSelect}
                  isLoading={isLoading}
                />
              </div>
            </div>

            {/* 7-Day National Forecast Table */}
            <div className="mt-8">
              <National7DayTable />
            </div>
          </>
        ) : activeTab === 'records' ? (
          /* Temperature Records Tab - Light Theme */
          <div className="space-y-4 bg-gray-50 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-6 rounded-lg">
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <h2 className="text-xl font-bold text-gray-900">Temperature Records Tracker</h2>
              <p className="text-sm text-gray-600 mt-1">
                NDFD forecast temperatures compared to historical records from WPC
              </p>
            </div>
            <NDFDRecordsMap />
          </div>
        ) : (
          /* Soundings Tab */
          <SoundingsTab />
        )}
      </main>

      <Footer />
    </div>
  );
}
