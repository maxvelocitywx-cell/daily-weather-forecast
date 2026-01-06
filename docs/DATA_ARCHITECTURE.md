# Max Velocity Weather - Backend & Data Architecture

## Overview

This document defines the complete backend architecture for the Max Velocity Weather platform, including data models, API design, risk score algorithm, caching strategy, and error handling.

**Stack:** Next.js 14+ App Router, TypeScript, Vercel KV (Redis), Open-Meteo API, OpenAI API

---

## Table of Contents

1. [Data Models (TypeScript Interfaces)](#1-data-models)
2. [Open-Meteo Request Plan](#2-open-meteo-request-plan)
3. [Risk Score Algorithm](#3-risk-score-algorithm)
4. [Freshness & Caching Strategy](#4-freshness--caching-strategy)
5. [API Route Design](#5-api-route-design)
6. [Error Handling & Fallbacks](#6-error-handling--fallbacks)
7. [Security Notes](#7-security-notes)
8. [Source Attribution](#8-source-attribution)

---

## 1. Data Models

### Core Configuration Types

```typescript
// lib/types/config.ts

/** US Region identifiers */
export type RegionId =
  | "pacific_nw"
  | "southwest"
  | "rockies"
  | "central_plains"
  | "midwest"
  | "south"
  | "northeast";

/** Region configuration */
export interface RegionConfig {
  id: RegionId;
  name: string;
  states: string[];
  samplingPoints: SamplingPoint[];
}

/** Geographic sampling point (city or geographic feature) */
export interface SamplingPoint {
  name: string;
  state: string;
  lat: number;
  lon: number;
  type: "city" | "geographic"; // city = major metro, geographic = lake-effect, mountain, etc.
  features?: ("lake_effect" | "mountain" | "coastal" | "plains" | "valley")[];
}

/** 7 US Regions Configuration */
export const REGIONS: Record<RegionId, RegionConfig> = {
  pacific_nw: {
    id: "pacific_nw",
    name: "Pacific Northwest",
    states: ["Washington", "Oregon", "Idaho"],
    samplingPoints: [
      { name: "Seattle", state: "WA", lat: 47.61, lon: -122.33, type: "city" },
      { name: "Portland", state: "OR", lat: 45.52, lon: -122.68, type: "city" },
      { name: "Spokane", state: "WA", lat: 47.66, lon: -117.43, type: "city" },
      { name: "Boise", state: "ID", lat: 43.62, lon: -116.21, type: "city" },
      { name: "Olympic Peninsula", state: "WA", lat: 47.80, lon: -123.50, type: "geographic", features: ["coastal", "mountain"] },
      { name: "Cascades (Mt Hood)", state: "OR", lat: 45.37, lon: -121.70, type: "geographic", features: ["mountain"] },
      { name: "Columbia Gorge", state: "OR", lat: 45.72, lon: -121.73, type: "geographic", features: ["valley"] },
    ],
  },
  southwest: {
    id: "southwest",
    name: "Southwest",
    states: ["California", "Nevada", "Arizona", "Utah", "New Mexico"],
    samplingPoints: [
      { name: "Los Angeles", state: "CA", lat: 34.05, lon: -118.24, type: "city" },
      { name: "San Francisco", state: "CA", lat: 37.77, lon: -122.42, type: "city" },
      { name: "San Diego", state: "CA", lat: 32.72, lon: -117.16, type: "city" },
      { name: "Phoenix", state: "AZ", lat: 33.45, lon: -112.07, type: "city" },
      { name: "Las Vegas", state: "NV", lat: 36.17, lon: -115.14, type: "city" },
      { name: "Salt Lake City", state: "UT", lat: 40.76, lon: -111.89, type: "city" },
      { name: "Albuquerque", state: "NM", lat: 35.08, lon: -106.65, type: "city" },
      { name: "Sierra Nevada (Tahoe)", state: "CA", lat: 39.09, lon: -120.03, type: "geographic", features: ["mountain"] },
      { name: "Flagstaff (N Arizona)", state: "AZ", lat: 35.20, lon: -111.65, type: "geographic", features: ["mountain"] },
      { name: "Central Valley (Fresno)", state: "CA", lat: 36.75, lon: -119.77, type: "geographic", features: ["valley"] },
    ],
  },
  rockies: {
    id: "rockies",
    name: "Rockies / High Plains",
    states: ["Colorado", "Wyoming", "Montana"],
    samplingPoints: [
      { name: "Denver", state: "CO", lat: 39.74, lon: -104.99, type: "city" },
      { name: "Colorado Springs", state: "CO", lat: 38.83, lon: -104.82, type: "city" },
      { name: "Cheyenne", state: "WY", lat: 41.14, lon: -104.82, type: "city" },
      { name: "Billings", state: "MT", lat: 45.78, lon: -108.50, type: "city" },
      { name: "Bozeman", state: "MT", lat: 45.68, lon: -111.04, type: "city" },
      { name: "Vail/I-70 Corridor", state: "CO", lat: 39.64, lon: -106.37, type: "geographic", features: ["mountain"] },
      { name: "Steamboat Springs", state: "CO", lat: 40.48, lon: -106.83, type: "geographic", features: ["mountain"] },
      { name: "Jackson Hole", state: "WY", lat: 43.48, lon: -110.76, type: "geographic", features: ["mountain", "valley"] },
      { name: "Glacier Park Area", state: "MT", lat: 48.70, lon: -113.80, type: "geographic", features: ["mountain"] },
    ],
  },
  central_plains: {
    id: "central_plains",
    name: "Central Plains",
    states: ["Texas", "Oklahoma", "Kansas", "Nebraska", "North Dakota", "South Dakota"],
    samplingPoints: [
      { name: "Dallas", state: "TX", lat: 32.78, lon: -96.80, type: "city" },
      { name: "Houston", state: "TX", lat: 29.76, lon: -95.37, type: "city" },
      { name: "Austin", state: "TX", lat: 30.27, lon: -97.74, type: "city" },
      { name: "Oklahoma City", state: "OK", lat: 35.47, lon: -97.52, type: "city" },
      { name: "Kansas City", state: "KS", lat: 39.10, lon: -94.58, type: "city" },
      { name: "Omaha", state: "NE", lat: 41.26, lon: -95.94, type: "city" },
      { name: "Fargo", state: "ND", lat: 46.88, lon: -96.79, type: "city" },
      { name: "Sioux Falls", state: "SD", lat: 43.55, lon: -96.73, type: "city" },
      { name: "Texas Panhandle (Amarillo)", state: "TX", lat: 35.22, lon: -101.83, type: "geographic", features: ["plains"] },
      { name: "Oklahoma Panhandle", state: "OK", lat: 36.75, lon: -101.50, type: "geographic", features: ["plains"] },
      { name: "Red River Valley", state: "ND", lat: 47.50, lon: -97.00, type: "geographic", features: ["valley", "plains"] },
    ],
  },
  midwest: {
    id: "midwest",
    name: "Midwest",
    states: ["Minnesota", "Iowa", "Missouri", "Illinois", "Indiana", "Ohio", "Michigan", "Wisconsin"],
    samplingPoints: [
      { name: "Chicago", state: "IL", lat: 41.88, lon: -87.63, type: "city" },
      { name: "Detroit", state: "MI", lat: 42.33, lon: -83.05, type: "city" },
      { name: "Minneapolis", state: "MN", lat: 44.98, lon: -93.27, type: "city" },
      { name: "Cleveland", state: "OH", lat: 41.50, lon: -81.69, type: "city" },
      { name: "Indianapolis", state: "IN", lat: 39.77, lon: -86.16, type: "city" },
      { name: "St. Louis", state: "MO", lat: 38.63, lon: -90.20, type: "city" },
      { name: "Milwaukee", state: "WI", lat: 43.04, lon: -87.91, type: "city" },
      { name: "Lake Michigan Shore (Muskegon)", state: "MI", lat: 43.23, lon: -86.25, type: "geographic", features: ["lake_effect", "coastal"] },
      { name: "Upper Peninsula", state: "MI", lat: 46.50, lon: -87.40, type: "geographic", features: ["lake_effect"] },
      { name: "NE Ohio Snowbelt", state: "OH", lat: 41.70, lon: -81.20, type: "geographic", features: ["lake_effect"] },
      { name: "Northern Minnesota", state: "MN", lat: 47.50, lon: -94.50, type: "geographic", features: ["plains"] },
    ],
  },
  south: {
    id: "south",
    name: "South",
    states: ["Louisiana", "Arkansas", "Mississippi", "Alabama", "Georgia", "Florida", "Tennessee", "Kentucky", "South Carolina", "North Carolina"],
    samplingPoints: [
      { name: "Atlanta", state: "GA", lat: 33.75, lon: -84.39, type: "city" },
      { name: "Miami", state: "FL", lat: 25.76, lon: -80.19, type: "city" },
      { name: "Tampa", state: "FL", lat: 27.95, lon: -82.46, type: "city" },
      { name: "Nashville", state: "TN", lat: 36.16, lon: -86.78, type: "city" },
      { name: "Charlotte", state: "NC", lat: 35.23, lon: -80.84, type: "city" },
      { name: "New Orleans", state: "LA", lat: 29.95, lon: -90.07, type: "city" },
      { name: "Memphis", state: "TN", lat: 35.15, lon: -90.05, type: "city" },
      { name: "Birmingham", state: "AL", lat: 33.52, lon: -86.80, type: "city" },
      { name: "Blue Ridge (Asheville)", state: "NC", lat: 35.60, lon: -82.55, type: "geographic", features: ["mountain"] },
      { name: "Florida Panhandle", state: "FL", lat: 30.40, lon: -86.60, type: "geographic", features: ["coastal"] },
      { name: "Outer Banks", state: "NC", lat: 35.90, lon: -75.60, type: "geographic", features: ["coastal"] },
    ],
  },
  northeast: {
    id: "northeast",
    name: "Northeast",
    states: ["Virginia", "West Virginia", "Maryland", "Delaware", "DC", "Pennsylvania", "New Jersey", "New York", "Connecticut", "Rhode Island", "Massachusetts", "Vermont", "New Hampshire", "Maine"],
    samplingPoints: [
      { name: "New York City", state: "NY", lat: 40.71, lon: -74.01, type: "city" },
      { name: "Boston", state: "MA", lat: 42.36, lon: -71.06, type: "city" },
      { name: "Philadelphia", state: "PA", lat: 39.95, lon: -75.17, type: "city" },
      { name: "Washington DC", state: "DC", lat: 38.91, lon: -77.04, type: "city" },
      { name: "Pittsburgh", state: "PA", lat: 40.44, lon: -80.00, type: "city" },
      { name: "Buffalo", state: "NY", lat: 42.89, lon: -78.88, type: "city", features: ["lake_effect"] },
      { name: "Syracuse", state: "NY", lat: 43.05, lon: -76.15, type: "city", features: ["lake_effect"] },
      { name: "Burlington", state: "VT", lat: 44.48, lon: -73.21, type: "city" },
      { name: "Portland", state: "ME", lat: 43.66, lon: -70.26, type: "city", features: ["coastal"] },
      { name: "Tug Hill Plateau", state: "NY", lat: 43.75, lon: -75.50, type: "geographic", features: ["lake_effect", "mountain"] },
      { name: "Watertown/Lake Ontario", state: "NY", lat: 43.97, lon: -75.91, type: "geographic", features: ["lake_effect"] },
      { name: "Adirondacks", state: "NY", lat: 44.00, lon: -74.20, type: "geographic", features: ["mountain"] },
      { name: "White Mountains", state: "NH", lat: 44.27, lon: -71.30, type: "geographic", features: ["mountain"] },
      { name: "Cape Cod", state: "MA", lat: 41.70, lon: -70.30, type: "geographic", features: ["coastal"] },
      { name: "Northern Maine", state: "ME", lat: 46.50, lon: -68.50, type: "geographic", features: ["mountain"] },
    ],
  },
};
```

### Raw Weather Data Types

```typescript
// lib/types/weather-raw.ts

/** Open-Meteo current conditions response */
export interface OpenMeteoCurrentData {
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  precipitation: number;
  rain: number;
  snowfall: number;
  weather_code: number;
  cloud_cover: number;
  pressure_msl: number;
  wind_speed_10m: number;
  wind_direction_10m: number;
  wind_gusts_10m: number;
  visibility: number;
  is_day: number;
}

/** Open-Meteo hourly data (HRRR Day 1) */
export interface OpenMeteoHourlyData {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  precipitation: number[];
  rain: number[];
  snowfall: number[];
  snow_depth: number[];
  weather_code: number[];
  cloud_cover: number[];
  visibility: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
  wind_gusts_10m: number[];
  cape: number[];
  lifted_index?: number[];
  freezing_level_height?: number[];
}

/** Open-Meteo daily data (ECMWF Days 2-7) */
export interface OpenMeteoDailyData {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  apparent_temperature_max: number[];
  apparent_temperature_min: number[];
  precipitation_sum: number[];
  rain_sum: number[];
  snowfall_sum: number[];
  precipitation_probability_max?: number[];
  wind_speed_10m_max: number[];
  wind_gusts_10m_max: number[];
  uv_index_max?: number[];
}

/** Parsed current conditions for a location */
export interface CurrentConditions {
  temperature: number;           // °F
  apparentTemperature: number;   // °F (feels like)
  relativeHumidity: number;      // %
  precipitation: number;         // inches (last 3 hours)
  rain: number;                  // inches
  snowfall: number;              // inches
  weatherCode: number;           // WMO code
  weatherDescription: string;
  cloudCover: number;            // %
  pressure: number;              // inHg
  windSpeed: number;             // mph
  windDirection: number;         // degrees
  windGusts: number;             // mph
  visibility: number;            // miles
  dewPoint: number;              // °F
  isDay: boolean;
  timestamp: string;             // ISO string
}

/** Day 1 forecast (HRRR-based) */
export interface Day1Forecast {
  tempHigh: number;
  tempLow: number;
  feelsLikeHigh: number;
  feelsLikeLow: number;
  totalPrecip: number;           // inches
  totalRain: number;             // inches
  totalSnow: number;             // inches
  maxSnowDepth: number;          // inches
  maxWindSpeed: number;          // mph
  maxWindGusts: number;          // mph
  avgWindDirection: number;      // degrees
  maxCape: number;               // J/kg
  minLiftedIndex: number;        // °C (severe weather proxy)
  minVisibility: number;         // miles
  avgCloudCover: number;         // %
  dominantWeatherCode: number;
  dominantWeatherDescription: string;
  freezingLevelMin: number;      // feet
  hourlyHighlights: string[];
}

/** Extended day forecast (ECMWF-based) */
export interface ExtendedDayForecast {
  date: string;                  // YYYY-MM-DD
  dayNumber: number;             // 2-7
  dayName: string;               // "Wednesday"
  tempHigh: number;
  tempLow: number;
  feelsLikeHigh: number;
  feelsLikeLow: number;
  totalPrecip: number;
  totalRain: number;
  totalSnow: number;
  precipProbability: number;     // %
  maxWindSpeed: number;
  maxWindGusts: number;
  weatherCode: number;
  weatherDescription: string;
}

/** Complete location forecast */
export interface LocationForecast {
  name: string;
  state: string;
  lat: number;
  lon: number;
  type: "city" | "geographic";
  features?: string[];
  current: CurrentConditions | null;
  day1: Day1Forecast;
  extendedDays: ExtendedDayForecast[];  // Days 2-7
  fetchedAt: string;             // ISO timestamp
}
```

### Derived Metrics & Risk Inputs

```typescript
// lib/types/derived-metrics.ts

/** Per-hazard risk contribution (0-10 scale, weighted) */
export interface HazardRiskScores {
  // Winter hazards
  snowAccumulation: number;      // Based on total snow inches
  snowRate: number;              // Based on hourly snowfall rates
  iceAccretion: number;          // Freezing rain/drizzle
  blizzardConditions: number;    // Snow + wind combo

  // Wind hazards
  highWinds: number;             // Sustained winds
  windGusts: number;             // Gust intensity

  // Severe weather hazards
  thunderstormPotential: number; // CAPE-based
  severeStormRisk: number;       // CAPE + wind shear proxy

  // Temperature hazards
  extremeCold: number;           // Wind chill danger
  extremeHeat: number;           // Heat index danger

  // Visibility hazards
  fogDense: number;              // Low visibility
  visibilityGeneral: number;     // Overall visibility impact

  // Precipitation hazards
  heavyRain: number;             // Flood potential

  // Composite
  rawTotal: number;              // Unweighted sum
  weightedTotal: number;         // Weighted by severity
}

/** Regional aggregated metrics */
export interface RegionMetrics {
  regionId: RegionId;
  regionName: string;
  locationCount: number;

  // Temperature aggregates
  tempRange: { min: number; max: number; avg: number };
  feelsLikeRange: { min: number; max: number };

  // Precipitation aggregates
  totalSnowRange: { min: number; max: number };
  totalPrecipRange: { min: number; max: number };
  locationsWithSnow: { name: string; amount: number }[];
  locationsWithRain: { name: string; amount: number }[];

  // Wind aggregates
  maxWindGusts: number;
  locationsWithHighWind: { name: string; gusts: number }[];

  // Severe weather indicators
  maxCape: number;
  locationsWithHighCape: { name: string; cape: number }[];

  // Visibility
  minVisibility: number;

  // Notable cities
  coldestLocation: { name: string; temp: number };
  warmestLocation: { name: string; temp: number };
  windiestLocation: { name: string; gusts: number };

  // Dominant conditions
  dominantConditions: string[];
}

/** Risk score input bundle for algorithm */
export interface RiskScoreInputs {
  regionId: RegionId;
  dayNumber: 1 | 2 | 3;

  // Raw metrics
  maxSnowfall: number;           // inches
  avgSnowfall: number;           // inches
  maxRainfall: number;           // inches
  maxWindGusts: number;          // mph
  maxCape: number;               // J/kg
  minVisibility: number;         // miles
  minFeelsLike: number;          // °F
  maxFeelsLike: number;          // °F

  // Geographic coverage (0-1)
  snowCoverage: number;          // % of locations with >0.5" snow
  rainCoverage: number;          // % of locations with >0.25" rain
  highWindCoverage: number;      // % of locations with >40mph gusts

  // Special conditions
  hasLakeEffect: boolean;
  hasMountainSnow: boolean;
  hasCoastalImpacts: boolean;
  hasFreezingRain: boolean;
  hasThunderstorms: boolean;

  // Computed hazard scores
  hazardScores: HazardRiskScores;
}
```

### Final API Payload Types

```typescript
// lib/types/api-payload.ts

import type { RegionId } from "./config";

/** Risk level label (matches 1-10 scale) */
export type RiskLevel =
  | "Very Quiet"
  | "Quiet"
  | "Marginal"
  | "Active"
  | "Elevated"
  | "High"
  | "Significant"
  | "Major"
  | "Severe"
  | "Extreme";

/** Per-day risk with reason */
export interface DayRisk {
  score: number;                 // 1.0-10.0
  label: RiskLevel;
  reason: string;                // Data-driven explanation
  primaryHazard: string;         // Main contributor
}

/** Per-day forecast content */
export interface DayForecast {
  narrative: string;             // OpenAI-generated OR fallback bullets
  highlights: string[];          // 2-5 key points
  risk: DayRisk;
  metrics: {
    tempRange: { low: number; high: number };
    snowRange?: { min: number; max: number };
    rainRange?: { min: number; max: number };
    windGusts?: number;
    cape?: number;
  };
}

/** Regional forecast payload */
export interface RegionForecast {
  id: RegionId;
  name: string;
  states: string[];

  // Per-day forecasts
  day1: DayForecast;
  day2: DayForecast;
  day3: DayForecast;

  // Days 4-7 summary
  longRange: {
    narrative: string;
    tempTrend: string;           // "warming" | "cooling" | "stable"
    precipOutlook: string;
    confidence: "low" | "moderate" | "high";
  };

  // Overall region risk (max of day1-3)
  overallRisk: {
    score: number;
    label: RiskLevel;
    peakDay: 1 | 2 | 3;
  };

  // Metadata
  patternCallout: string;        // e.g., "Active northern jet"
  impacts: string[];             // ["Travel", "Winter"]
  focusArea: string;             // Geographic focus
  notHappening: string;          // Reassurance
}

/** National summary payload */
export interface NationalSummary {
  paragraphs: string[];          // 2-3 narrative paragraphs
  nationalRisk: {
    score: number;
    label: RiskLevel;
    trend: "rising" | "falling" | "steady";
  };
  leadStory: {
    region: RegionId;
    headline: string;
  };
  quietestRegion: RegionId;
  mostActiveRegion: RegionId;
}

/** Risk history entry */
export interface RiskHistoryEntry {
  timestamp: number;             // Unix ms
  score: number;
}

/** Risk trend data */
export interface RiskTrend {
  current: number;
  history: {
    "1h": { score: number | null; change: number | null };
    "3h": { score: number | null; change: number | null };
    "6h": { score: number | null; change: number | null };
    "12h": { score: number | null; change: number | null };
    "24h": { score: number | null; change: number | null };
  };
}

/** Source attribution */
export interface SourceAttribution {
  models: {
    day1: string;                // "NOAA HRRR (3km, hourly updates)"
    extended: string;            // "ECMWF (best global medium-range)"
  };
  provider: string;              // "Open-Meteo Weather API"
  riskAlgorithm: string;         // "Max Velocity proprietary scoring"
  lastModelRun: string;          // "06z" or "12z"
  dataTimestamp: string;         // ISO string
}

/** Complete API response */
export interface WeatherSynopsisResponse {
  // Timestamps
  updatedUtc: string;
  dataFetchedAt: string;
  narrativeGeneratedAt: string;

  // Day labels
  dayLabels: {
    day1: string;                // "Monday"
    day2: string;
    day3: string;
  };

  // Content
  national: NationalSummary;
  regions: RegionForecast[];     // 7 regions

  // Risk tracking
  nationalRiskTrend: RiskTrend;

  // Attribution
  sources: SourceAttribution;

  // Cache info
  cacheStatus: "fresh" | "stale-while-revalidate" | "stale";
  nextRefreshAt: string;
}

/** Fallback data (when OpenAI fails) */
export interface FallbackForecast {
  type: "data-driven";
  narrative: null;
  bullets: string[];             // Auto-generated from metrics
  metrics: DayForecast["metrics"];
  risk: DayRisk;
}
```

---

## 2. Open-Meteo Request Plan

### Endpoint Strategy

| Data Type | Endpoint | Model | Variables | Refresh |
|-----------|----------|-------|-----------|---------|
| Current Conditions | `/v1/gfs` | GFS/HRRR blend | current + past_hours=3 | 10 min |
| Day 1 Forecast | `/v1/gfs` | HRRR auto-blend | hourly, forecast_hours=24 | 10 min |
| Day 1 Snowfall | `previous-runs-api.open-meteo.com/v1/forecast` | HRRR 06z run | hourly snowfall, snow_depth | 10 min |
| Days 2-7 | `/v1/ecmwf` | ECMWF | daily | 30 min |

### API Request URLs

```typescript
// lib/open-meteo/urls.ts

const BASE_URL = "https://api.open-meteo.com";
const PREVIOUS_RUNS_URL = "https://previous-runs-api.open-meteo.com";

export function buildCurrentConditionsUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "precipitation",
      "rain",
      "snowfall",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "visibility",
      "is_day",
    ].join(","),
    hourly: ["precipitation", "rain", "snowfall", "visibility"].join(","),
    past_hours: "3",
    forecast_hours: "0",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "America/New_York",
  });
  return `${BASE_URL}/v1/gfs?${params}`;
}

export function buildDay1ForecastUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: [
      "temperature_2m",
      "apparent_temperature",
      "precipitation",
      "rain",
      "snowfall",
      "snow_depth",
      "weather_code",
      "cloud_cover",
      "visibility",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "cape",
      "lifted_index",
      "freezing_level_height",
    ].join(","),
    forecast_hours: "24",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "America/New_York",
  });
  return `${BASE_URL}/v1/gfs?${params}`;
}

export function buildSnowfall06zUrl(lat: number, lon: number, pastRuns: number): string {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    hourly: ["snowfall", "snow_depth"].join(","),
    past_runs: pastRuns.toString(),
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    timezone: "UTC",
  });
  return `${PREVIOUS_RUNS_URL}/v1/forecast?${params}`;
}

export function buildExtendedForecastUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "precipitation_sum",
      "rain_sum",
      "snowfall_sum",
      "precipitation_probability_max",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
    ].join(","),
    forecast_days: "8",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "America/New_York",
  });
  return `${BASE_URL}/v1/ecmwf?${params}`;
}
```

### Timezone Handling

```typescript
// lib/open-meteo/timezone.ts

/**
 * All Open-Meteo requests use America/New_York for consistent day boundaries.
 * Server-side processing always uses UTC internally.
 * Client displays convert to user's local timezone.
 */

export function getCurrentEasternDate(): string {
  return new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function getDayName(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  // Use Eastern Time for day labels
  const estString = d.toLocaleString("en-US", { timeZone: "America/New_York" });
  const estDate = new Date(estString);
  return estDate.toLocaleDateString("en-US", { weekday: "long" });
}

export function getHoursSince06z(): number {
  const now = new Date();
  const utcHour = now.getUTCHours();
  return utcHour >= 6 ? utcHour - 6 : utcHour + 18;
}
```

### Batching Strategy

```typescript
// lib/open-meteo/fetcher.ts

const BATCH_SIZE = 10;           // Concurrent requests per batch
const REQUEST_TIMEOUT = 10000;   // 10 seconds
const RETRY_ATTEMPTS = 2;

export async function fetchAllLocationForecasts(
  locations: SamplingPoint[]
): Promise<LocationForecast[]> {
  const results: LocationForecast[] = [];

  // Process in batches to avoid overwhelming the API
  for (let i = 0; i < locations.length; i += BATCH_SIZE) {
    const batch = locations.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(loc => fetchLocationForecast(loc))
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value) {
        results.push(result.value);
      }
    }
  }

  return results;
}
```

---

## 3. Risk Score Algorithm

### Philosophy

The Max Velocity Risk Score (1-10) measures:
1. **Impact Severity** - How dangerous/disruptive is the weather?
2. **Geographic Coverage** - How widespread are the impacts?
3. **Confidence** - How certain are we about the forecast?

### Hazard-Specific Scoring

```typescript
// lib/risk/hazard-scores.ts

export interface HazardThresholds {
  // Returns a score from 0-10 for each hazard
}

/**
 * Snow Accumulation Score
 * Based on 24-hour snowfall totals
 */
export function scoreSnowAccumulation(inches: number): number {
  if (inches < 0.5) return 0;
  if (inches < 1) return 1;
  if (inches < 2) return 2;
  if (inches < 4) return 3;
  if (inches < 6) return 4;
  if (inches < 8) return 5;
  if (inches < 12) return 6;
  if (inches < 18) return 7;
  if (inches < 24) return 8;
  if (inches < 36) return 9;
  return 10;  // 36"+ = historic
}

/**
 * Wind Gust Score
 * Based on maximum wind gusts
 */
export function scoreWindGusts(mph: number): number {
  if (mph < 25) return 0;
  if (mph < 35) return 1;
  if (mph < 40) return 2;
  if (mph < 45) return 3;
  if (mph < 50) return 4;
  if (mph < 58) return 5;   // NWS High Wind threshold
  if (mph < 65) return 6;
  if (mph < 75) return 7;
  if (mph < 90) return 8;
  if (mph < 110) return 9;
  return 10;  // Hurricane force
}

/**
 * CAPE-based Thunderstorm Score
 * CAPE = Convective Available Potential Energy
 */
export function scoreCape(joules: number): number {
  if (joules < 250) return 0;
  if (joules < 500) return 1;
  if (joules < 1000) return 2;
  if (joules < 1500) return 3;
  if (joules < 2000) return 4;
  if (joules < 2500) return 5;
  if (joules < 3000) return 6;
  if (joules < 4000) return 7;
  if (joules < 5000) return 8;
  if (joules < 6000) return 9;
  return 10;  // Extreme instability
}

/**
 * Wind Chill Score (Extreme Cold)
 * Based on feels-like temperature
 */
export function scoreWindChill(feelsLikeF: number): number {
  if (feelsLikeF > 20) return 0;
  if (feelsLikeF > 10) return 1;
  if (feelsLikeF > 0) return 2;
  if (feelsLikeF > -10) return 3;
  if (feelsLikeF > -20) return 4;
  if (feelsLikeF > -30) return 5;
  if (feelsLikeF > -40) return 6;
  if (feelsLikeF > -50) return 7;
  if (feelsLikeF > -60) return 8;
  if (feelsLikeF > -70) return 9;
  return 10;  // Extreme cold
}

/**
 * Visibility Score
 * Based on minimum visibility in miles
 */
export function scoreVisibility(miles: number): number {
  if (miles > 6) return 0;
  if (miles > 3) return 1;
  if (miles > 1) return 2;
  if (miles > 0.5) return 3;
  if (miles > 0.25) return 4;   // Dense fog threshold
  if (miles > 0.1) return 5;
  if (miles > 0.05) return 6;
  return 7;  // Near-zero visibility
}

/**
 * Heavy Rain Score
 * Based on 24-hour rainfall totals
 */
export function scoreRainfall(inches: number): number {
  if (inches < 0.25) return 0;
  if (inches < 0.5) return 1;
  if (inches < 1) return 2;
  if (inches < 2) return 3;
  if (inches < 3) return 4;
  if (inches < 4) return 5;
  if (inches < 6) return 6;
  if (inches < 8) return 7;
  if (inches < 12) return 8;
  if (inches < 18) return 9;
  return 10;  // Catastrophic rainfall
}

/**
 * Blizzard Conditions Score
 * Combines snow rate + wind + visibility
 */
export function scoreBlizzardConditions(
  snowInches: number,
  windGustsMph: number,
  visibilityMiles: number
): number {
  // Blizzard = sustained winds ≥35 mph + falling/blowing snow + visibility ≤0.25 mi
  const hasSignificantSnow = snowInches >= 4;
  const hasHighWinds = windGustsMph >= 35;
  const hasLowVisibility = visibilityMiles <= 1;

  if (!hasSignificantSnow) return 0;

  let score = scoreSnowAccumulation(snowInches);

  if (hasHighWinds) {
    score += 2;
    if (windGustsMph >= 45) score += 1;
  }

  if (hasLowVisibility) {
    score += 1;
    if (visibilityMiles <= 0.25) score += 1;
  }

  return Math.min(score, 10);
}

/**
 * Freezing Rain Score
 * Based on weather codes 66, 67 (freezing rain)
 */
export function scoreFreezingRain(
  hasFreezingRain: boolean,
  totalPrecip: number
): number {
  if (!hasFreezingRain) return 0;
  if (totalPrecip < 0.1) return 2;
  if (totalPrecip < 0.25) return 4;
  if (totalPrecip < 0.5) return 6;
  if (totalPrecip < 1.0) return 8;
  return 10;  // Major ice storm
}
```

### Composite Risk Score Calculation

```typescript
// lib/risk/calculator.ts

import type { RiskScoreInputs, HazardRiskScores } from "../types/derived-metrics";

/** Hazard weights (sum to 1.0) */
const HAZARD_WEIGHTS = {
  snowAccumulation: 0.20,
  windGusts: 0.15,
  blizzardConditions: 0.15,
  thunderstormPotential: 0.10,
  extremeCold: 0.10,
  heavyRain: 0.10,
  visibility: 0.08,
  iceAccretion: 0.07,
  extremeHeat: 0.05,
};

/** Coverage multiplier (rewards widespread vs localized) */
function getCoverageMultiplier(coverage: number): number {
  if (coverage < 0.1) return 0.6;   // Very localized
  if (coverage < 0.25) return 0.75;
  if (coverage < 0.5) return 0.9;
  if (coverage < 0.75) return 1.0;
  return 1.1;  // Widespread (bonus)
}

/** Calculate regional risk score for a single day */
export function calculateDayRiskScore(inputs: RiskScoreInputs): {
  score: number;
  label: string;
  primaryHazard: string;
  reason: string;
} {
  const scores = inputs.hazardScores;

  // Find the primary (highest) hazard
  const hazardEntries = [
    { name: "Snow", score: scores.snowAccumulation, weight: HAZARD_WEIGHTS.snowAccumulation },
    { name: "Wind", score: scores.windGusts, weight: HAZARD_WEIGHTS.windGusts },
    { name: "Blizzard", score: scores.blizzardConditions, weight: HAZARD_WEIGHTS.blizzardConditions },
    { name: "Thunderstorms", score: scores.thunderstormPotential, weight: HAZARD_WEIGHTS.thunderstormPotential },
    { name: "Cold", score: scores.extremeCold, weight: HAZARD_WEIGHTS.extremeCold },
    { name: "Rain", score: scores.heavyRain, weight: HAZARD_WEIGHTS.heavyRain },
    { name: "Visibility", score: scores.fogDense, weight: HAZARD_WEIGHTS.visibility },
    { name: "Ice", score: scores.iceAccretion, weight: HAZARD_WEIGHTS.iceAccretion },
    { name: "Heat", score: scores.extremeHeat, weight: HAZARD_WEIGHTS.extremeHeat },
  ];

  // Calculate weighted score
  let weightedSum = 0;
  for (const h of hazardEntries) {
    weightedSum += h.score * h.weight;
  }

  // Apply coverage multiplier
  const avgCoverage = (inputs.snowCoverage + inputs.rainCoverage + inputs.highWindCoverage) / 3;
  const coverageMultiplier = getCoverageMultiplier(avgCoverage);

  // Find primary hazard
  const primaryHazard = hazardEntries.reduce((max, h) =>
    h.score > max.score ? h : max
  );

  // Calculate final score
  let finalScore = weightedSum * coverageMultiplier;

  // Boost for special conditions
  if (inputs.hasLakeEffect && inputs.maxSnowfall >= 6) finalScore *= 1.1;
  if (inputs.hasFreezingRain) finalScore *= 1.15;
  if (inputs.hasMountainSnow && inputs.maxSnowfall >= 12) finalScore *= 1.05;

  // Clamp to 1.0-10.0 range
  finalScore = Math.max(1.0, Math.min(10.0, finalScore));
  finalScore = Math.round(finalScore * 10) / 10;  // Round to 0.1

  // Generate reason based on actual data
  const reason = generateRiskReason(inputs, primaryHazard.name);

  return {
    score: finalScore,
    label: getRiskLabel(finalScore),
    primaryHazard: primaryHazard.name,
    reason,
  };
}

/** Get risk label from score */
export function getRiskLabel(score: number): string {
  if (score < 1.5) return "Very Quiet";
  if (score < 2.5) return "Quiet";
  if (score < 3.5) return "Marginal";
  if (score < 4.5) return "Active";
  if (score < 5.5) return "Elevated";
  if (score < 6.5) return "High";
  if (score < 7.5) return "Significant";
  if (score < 8.5) return "Major";
  if (score < 9.5) return "Severe";
  return "Extreme";
}

/** Generate data-driven risk reason */
function generateRiskReason(inputs: RiskScoreInputs, primaryHazard: string): string {
  const parts: string[] = [];

  if (primaryHazard === "Snow" && inputs.maxSnowfall >= 1) {
    parts.push(`${inputs.maxSnowfall.toFixed(1)}" of snow expected`);
  }

  if (primaryHazard === "Wind" && inputs.maxWindGusts >= 35) {
    parts.push(`Wind gusts to ${inputs.maxWindGusts} mph`);
  }

  if (primaryHazard === "Blizzard") {
    parts.push(`Blizzard conditions with ${inputs.maxSnowfall.toFixed(1)}" snow and ${inputs.maxWindGusts} mph gusts`);
  }

  if (primaryHazard === "Thunderstorms" && inputs.maxCape >= 1000) {
    parts.push(`CAPE values to ${inputs.maxCape} J/kg indicate thunderstorm potential`);
  }

  if (primaryHazard === "Cold" && inputs.minFeelsLike <= 0) {
    parts.push(`Wind chills dropping to ${inputs.minFeelsLike}°F`);
  }

  if (primaryHazard === "Rain" && inputs.maxRainfall >= 0.5) {
    parts.push(`${inputs.maxRainfall.toFixed(2)}" of rain possible`);
  }

  if (inputs.hasLakeEffect) {
    parts.push("Lake-effect enhancement likely");
  }

  if (inputs.hasFreezingRain) {
    parts.push("Freezing rain possible");
  }

  // Fallback for quiet conditions
  if (parts.length === 0) {
    if (inputs.maxSnowfall < 0.5 && inputs.maxRainfall < 0.25 && inputs.maxWindGusts < 25) {
      return "Quiet weather with no significant impacts expected";
    }
    parts.push("Minor weather features possible");
  }

  return parts.join(". ") + ".";
}

/** Calculate national risk from regional scores */
export function calculateNationalRisk(
  regionalScores: { regionId: string; score: number }[]
): { score: number; label: string; mostActiveRegion: string } {
  // National score = weighted average with bonus for multiple active regions
  const scores = regionalScores.map(r => r.score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const max = Math.max(...scores);

  // Count regions above "Active" threshold
  const activeRegions = scores.filter(s => s >= 4).length;

  // Weighted: 60% max, 30% avg, 10% coverage bonus
  let national = max * 0.6 + avg * 0.3;
  if (activeRegions >= 3) national += 0.5;
  if (activeRegions >= 5) national += 0.5;

  national = Math.max(1.0, Math.min(10.0, national));
  national = Math.round(national * 100) / 100;  // Round to 0.01

  const mostActive = regionalScores.reduce((max, r) =>
    r.score > max.score ? r : max
  );

  return {
    score: national,
    label: getRiskLabel(national),
    mostActiveRegion: mostActive.regionId,
  };
}
```

### Tunable Thresholds Configuration

```typescript
// lib/risk/thresholds.ts

/**
 * Thresholds can be adjusted based on seasonal norms,
 * user feedback, or operational experience.
 */
export const RISK_THRESHOLDS = {
  snow: {
    trace: 0.1,           // Trace amounts
    light: 1.0,           // Light snow
    moderate: 4.0,        // Moderate accumulation
    heavy: 8.0,           // Heavy snow
    extreme: 18.0,        // Major event
    historic: 36.0,       // Historic
  },
  wind: {
    advisory: 35,         // Wind Advisory threshold
    warning: 50,          // High Wind Warning
    damaging: 58,         // Damaging wind
    severe: 75,           // Severe
    extreme: 100,         // Extreme/hurricane
  },
  cape: {
    minimal: 250,         // Weak instability
    marginal: 1000,       // Marginal severe
    moderate: 1500,       // Moderate severe
    high: 2500,           // High severe
    extreme: 4000,        // Extreme instability
  },
  coldWindChill: {
    advisory: 0,          // Wind Chill Advisory
    warning: -25,         // Wind Chill Warning
    extreme: -45,         // Extreme Cold
    dangerous: -60,       // Life-threatening
  },
  visibility: {
    good: 6,              // Good visibility
    moderate: 3,          // Moderate
    low: 1,               // Low
    veryLow: 0.5,         // Very low
    dense: 0.25,          // Dense fog
  },
  rain: {
    light: 0.25,          // Light rain
    moderate: 1.0,        // Moderate
    heavy: 2.0,           // Heavy
    excessive: 4.0,       // Excessive
    extreme: 8.0,         // Extreme/flood
  },
} as const;
```

---

## 4. Freshness & Caching Strategy

### Cache Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                         │
│  Cache-Control: s-maxage=300, stale-while-revalidate=600       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     VERCEL EDGE CACHE                           │
│  CDN-level caching, automatic invalidation on revalidation     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     VERCEL KV (Redis)                           │
│  - Raw weather data: TTL 10 minutes                            │
│  - Narrative content: TTL 30-60 minutes                        │
│  - Risk history: TTL 25 hours (rolling window)                 │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     OPEN-METEO API                              │
│  - Current: Updates ~every 15 min                              │
│  - HRRR: Updates ~hourly                                       │
│  - ECMWF: Updates ~every 6 hours                               │
└─────────────────────────────────────────────────────────────────┘
```

### Cache Keys & TTLs

```typescript
// lib/cache/keys.ts

export const CACHE_KEYS = {
  // Raw weather data (per region)
  rawWeatherData: (regionId: string) => `weather:raw:${regionId}`,

  // Computed metrics (per region)
  regionMetrics: (regionId: string) => `weather:metrics:${regionId}`,

  // Risk scores (per region, per day)
  riskScore: (regionId: string, day: number) => `risk:${regionId}:day${day}`,

  // National summary
  nationalSummary: () => "weather:national:summary",

  // Narrative content (OpenAI-generated)
  narrativeContent: () => "weather:narrative:full",

  // Data hash for change detection
  dataHash: () => "weather:hash:current",

  // Risk history (for trend tracking)
  riskHistory: () => "weather:risk:history",

  // Last successful fetch timestamp
  lastFetch: () => "weather:last:fetch",
};

export const CACHE_TTLS = {
  rawWeatherData: 600,          // 10 minutes
  regionMetrics: 600,           // 10 minutes
  riskScore: 600,               // 10 minutes
  nationalSummary: 1800,        // 30 minutes
  narrativeContent: 3600,       // 60 minutes
  dataHash: 600,                // 10 minutes
  riskHistory: 90000,           // 25 hours
};
```

### Change Detection (Hash-Based)

```typescript
// lib/cache/change-detection.ts

import { createHash } from "crypto";
import type { RegionMetrics } from "../types/derived-metrics";

/**
 * Generate a hash of the key metrics that would trigger a narrative refresh.
 * Minor fluctuations (±0.1° temp, etc.) won't trigger a refresh.
 */
export function generateDataHash(metrics: RegionMetrics[]): string {
  const significantData = metrics.map(m => ({
    id: m.regionId,
    // Round to reduce noise
    tempMin: Math.round(m.tempRange.min / 2) * 2,
    tempMax: Math.round(m.tempRange.max / 2) * 2,
    snowMax: Math.round(m.totalSnowRange.max),
    rainMax: Math.round(m.totalPrecipRange.max * 4) / 4,
    windMax: Math.round(m.maxWindGusts / 5) * 5,
    cape: Math.round(m.maxCape / 250) * 250,
  }));

  const json = JSON.stringify(significantData);
  return createHash("md5").update(json).digest("hex");
}

/**
 * Determine if data has changed enough to warrant a narrative refresh.
 */
export async function hasSignificantChange(
  kv: any,
  newHash: string
): Promise<boolean> {
  const oldHash = await kv.get(CACHE_KEYS.dataHash());
  return oldHash !== newHash;
}
```

### Revalidation Strategy

```typescript
// lib/cache/revalidation.ts

import { kv } from "@vercel/kv";

export interface RefreshDecision {
  shouldRefreshData: boolean;
  shouldRefreshNarrative: boolean;
  reason: string;
}

export async function determineRefreshNeeds(): Promise<RefreshDecision> {
  const now = Date.now();

  // Get last fetch timestamps
  const lastDataFetch = await kv.get<number>("weather:last:data_fetch") || 0;
  const lastNarrativeFetch = await kv.get<number>("weather:last:narrative_fetch") || 0;
  const lastDataHash = await kv.get<string>(CACHE_KEYS.dataHash());

  const dataTTL = CACHE_TTLS.rawWeatherData * 1000;      // 10 min
  const narrativeTTL = CACHE_TTLS.narrativeContent * 1000; // 60 min

  const dataAge = now - lastDataFetch;
  const narrativeAge = now - lastNarrativeFetch;

  // Always refresh data if TTL expired
  if (dataAge > dataTTL) {
    return {
      shouldRefreshData: true,
      shouldRefreshNarrative: narrativeAge > narrativeTTL,
      reason: "Data TTL expired",
    };
  }

  // Refresh narrative if TTL expired OR significant data change
  if (narrativeAge > narrativeTTL) {
    return {
      shouldRefreshData: false,
      shouldRefreshNarrative: true,
      reason: "Narrative TTL expired",
    };
  }

  return {
    shouldRefreshData: false,
    shouldRefreshNarrative: false,
    reason: "All caches fresh",
  };
}
```

### Risk History Management

```typescript
// lib/cache/risk-history.ts

import { kv } from "@vercel/kv";
import type { RiskHistoryEntry, RiskTrend } from "../types/api-payload";

const RISK_HISTORY_KEY = "national_risk_history";
const MAX_HISTORY_HOURS = 25;

export async function storeRiskHistory(risk: number): Promise<void> {
  try {
    const history: RiskHistoryEntry[] = await kv.get(RISK_HISTORY_KEY) || [];
    const now = Date.now();
    const cutoff = now - MAX_HISTORY_HOURS * 60 * 60 * 1000;

    // Remove entries older than 25 hours
    const filtered = history.filter(entry => entry.timestamp > cutoff);

    // Add new entry
    filtered.push({ timestamp: now, score: risk });

    // Save back
    await kv.set(RISK_HISTORY_KEY, filtered);
  } catch (error) {
    console.error("Failed to store risk history:", error);
  }
}

export async function getRiskTrend(currentRisk: number): Promise<RiskTrend> {
  const history: RiskHistoryEntry[] = await kv.get(RISK_HISTORY_KEY) || [];
  const now = Date.now();

  const intervals = {
    "1h": 60 * 60 * 1000,
    "3h": 3 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
  };

  const trend: RiskTrend = {
    current: currentRisk,
    history: {
      "1h": { score: null, change: null },
      "3h": { score: null, change: null },
      "6h": { score: null, change: null },
      "12h": { score: null, change: null },
      "24h": { score: null, change: null },
    },
  };

  for (const [key, ms] of Object.entries(intervals)) {
    const targetTime = now - ms;
    // Find closest entry to target time
    const closest = history
      .filter(e => e.timestamp <= targetTime)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (closest) {
      trend.history[key as keyof typeof intervals] = {
        score: closest.score,
        change: Math.round((currentRisk - closest.score) * 100) / 100,
      };
    }
  }

  return trend;
}
```

---

## 5. API Route Design

### Route Structure

```
app/api/
├── weather/
│   ├── synopsis/route.ts      # Full regional forecasts (OpenAI narratives)
│   ├── national/route.ts      # National summary only
│   ├── risk-history/route.ts  # Risk trend data
│   └── metrics/route.ts       # Raw metrics (no narrative)
├── internal/
│   ├── refresh/route.ts       # Cron-triggered refresh
│   └── health/route.ts        # Health check
```

### Main Synopsis Route

```typescript
// app/api/weather/synopsis/route.ts

import { NextResponse } from "next/server";
import { kv } from "@vercel/kv";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const startTime = Date.now();

  try {
    // Check cache first
    const cachedResponse = await kv.get<WeatherSynopsisResponse>("weather:synopsis:full");
    const cacheAge = cachedResponse
      ? Date.now() - new Date(cachedResponse.dataFetchedAt).getTime()
      : Infinity;

    // Return cached if fresh (< 5 min)
    if (cachedResponse && cacheAge < 300000) {
      return NextResponse.json({
        ...cachedResponse,
        cacheStatus: "fresh",
      }, {
        headers: getCacheHeaders("fresh"),
      });
    }

    // Determine what needs refreshing
    const { shouldRefreshData, shouldRefreshNarrative } = await determineRefreshNeeds();

    let response: WeatherSynopsisResponse;

    if (shouldRefreshData || !cachedResponse) {
      // Full refresh: fetch data + generate narratives
      response = await generateFullSynopsis();
    } else if (shouldRefreshNarrative) {
      // Narrative refresh only (use cached data)
      response = await refreshNarrativesOnly(cachedResponse);
    } else {
      // Serve stale while revalidating
      response = {
        ...cachedResponse,
        cacheStatus: "stale-while-revalidate",
      };
      // Trigger background refresh
      triggerBackgroundRefresh();
    }

    // Cache the response
    await kv.set("weather:synopsis:full", response, { ex: 3600 });

    console.log(`Synopsis generated in ${(Date.now() - startTime) / 1000}s`);

    return NextResponse.json(response, {
      headers: getCacheHeaders(response.cacheStatus),
    });

  } catch (error) {
    console.error("Synopsis API error:", error);

    // Try to return stale data on error
    const staleData = await kv.get<WeatherSynopsisResponse>("weather:synopsis:full");
    if (staleData) {
      return NextResponse.json({
        ...staleData,
        cacheStatus: "stale",
        error: "Using cached data due to upstream error",
      }, {
        headers: getCacheHeaders("stale"),
      });
    }

    return NextResponse.json(
      { error: "Failed to generate synopsis" },
      { status: 502 }
    );
  }
}

function getCacheHeaders(status: string): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  switch (status) {
    case "fresh":
      headers["Cache-Control"] = "s-maxage=300, stale-while-revalidate=600";
      break;
    case "stale-while-revalidate":
      headers["Cache-Control"] = "s-maxage=60, stale-while-revalidate=300";
      break;
    case "stale":
      headers["Cache-Control"] = "s-maxage=60";
      break;
  }

  return headers;
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
```

---

## 6. Error Handling & Fallbacks

### Fallback Generation (When OpenAI Fails)

```typescript
// lib/fallback/generator.ts

import type { RegionMetrics } from "../types/derived-metrics";
import type { DayForecast, FallbackForecast } from "../types/api-payload";

/**
 * Generate data-driven bullet points when OpenAI is unavailable.
 * Uses only the raw metrics - no hallucination possible.
 */
export function generateFallbackForecast(
  metrics: RegionMetrics,
  dayNumber: 1 | 2 | 3
): FallbackForecast {
  const bullets: string[] = [];

  // Temperature bullet
  bullets.push(
    `Temperatures ranging from ${metrics.tempRange.min}°F to ${metrics.tempRange.max}°F`
  );

  // Coldest/warmest locations
  if (metrics.coldestLocation.name && metrics.warmestLocation.name) {
    bullets.push(
      `Coldest: ${metrics.coldestLocation.name} (${metrics.coldestLocation.temp}°F), ` +
      `Warmest: ${metrics.warmestLocation.name} (${metrics.warmestLocation.temp}°F)`
    );
  }

  // Snow bullet
  if (metrics.totalSnowRange.max >= 0.5) {
    bullets.push(
      `Snow accumulation: ${metrics.totalSnowRange.min.toFixed(1)}" to ${metrics.totalSnowRange.max.toFixed(1)}"`
    );
    if (metrics.locationsWithSnow.length > 0) {
      const top3 = metrics.locationsWithSnow.slice(0, 3);
      bullets.push(
        `Heaviest snow: ${top3.map(l => `${l.name} (${l.amount.toFixed(1)}")`).join(", ")}`
      );
    }
  }

  // Rain bullet
  if (metrics.totalPrecipRange.max >= 0.25) {
    bullets.push(
      `Rainfall: ${metrics.totalPrecipRange.min.toFixed(2)}" to ${metrics.totalPrecipRange.max.toFixed(2)}"`
    );
  }

  // Wind bullet
  if (metrics.maxWindGusts >= 30) {
    bullets.push(`Wind gusts up to ${metrics.maxWindGusts} mph`);
    if (metrics.windiestLocation.name) {
      bullets.push(`Windiest: ${metrics.windiestLocation.name} (${metrics.windiestLocation.gusts} mph)`);
    }
  }

  // Conditions bullet
  if (metrics.dominantConditions.length > 0) {
    bullets.push(`Conditions: ${metrics.dominantConditions.join(", ")}`);
  }

  // CAPE/severe weather bullet
  if (metrics.maxCape >= 1000) {
    bullets.push(`Thunderstorm potential: CAPE ${metrics.maxCape} J/kg`);
  }

  return {
    type: "data-driven",
    narrative: null,
    bullets,
    metrics: {
      tempRange: { low: metrics.tempRange.min, high: metrics.tempRange.max },
      snowRange: metrics.totalSnowRange.max > 0
        ? { min: metrics.totalSnowRange.min, max: metrics.totalSnowRange.max }
        : undefined,
      rainRange: metrics.totalPrecipRange.max > 0
        ? { min: metrics.totalPrecipRange.min, max: metrics.totalPrecipRange.max }
        : undefined,
      windGusts: metrics.maxWindGusts > 0 ? metrics.maxWindGusts : undefined,
      cape: metrics.maxCape > 0 ? metrics.maxCape : undefined,
    },
    risk: calculateDayRiskScore({
      regionId: metrics.regionId,
      dayNumber,
      maxSnowfall: metrics.totalSnowRange.max,
      avgSnowfall: (metrics.totalSnowRange.min + metrics.totalSnowRange.max) / 2,
      maxRainfall: metrics.totalPrecipRange.max,
      maxWindGusts: metrics.maxWindGusts,
      maxCape: metrics.maxCape,
      minVisibility: metrics.minVisibility,
      minFeelsLike: metrics.feelsLikeRange.min,
      maxFeelsLike: metrics.feelsLikeRange.max,
      snowCoverage: metrics.locationsWithSnow.length / metrics.locationCount,
      rainCoverage: metrics.locationsWithRain.length / metrics.locationCount,
      highWindCoverage: metrics.locationsWithHighWind.length / metrics.locationCount,
      hasLakeEffect: false, // Would need to check features
      hasMountainSnow: false,
      hasCoastalImpacts: false,
      hasFreezingRain: false,
      hasThunderstorms: metrics.maxCape >= 1000,
      hazardScores: computeHazardScores(metrics),
    }),
  };
}
```

### Error Categories & Handling

```typescript
// lib/errors/handler.ts

export type ErrorCategory =
  | "OPEN_METEO_TIMEOUT"
  | "OPEN_METEO_RATE_LIMIT"
  | "OPEN_METEO_DATA_ERROR"
  | "OPENAI_TIMEOUT"
  | "OPENAI_RATE_LIMIT"
  | "OPENAI_CONTENT_FILTER"
  | "CACHE_ERROR"
  | "UNKNOWN";

export interface ErrorContext {
  category: ErrorCategory;
  message: string;
  recoverable: boolean;
  fallbackAvailable: boolean;
}

export function categorizeError(error: unknown): ErrorContext {
  const message = error instanceof Error ? error.message : String(error);

  // Open-Meteo errors
  if (message.includes("timeout") && message.includes("open-meteo")) {
    return {
      category: "OPEN_METEO_TIMEOUT",
      message: "Weather data source temporarily slow",
      recoverable: true,
      fallbackAvailable: true,
    };
  }

  if (message.includes("429") || message.includes("rate limit")) {
    return {
      category: "OPEN_METEO_RATE_LIMIT",
      message: "Weather API rate limited",
      recoverable: true,
      fallbackAvailable: true,
    };
  }

  // OpenAI errors
  if (message.includes("OpenAI") && message.includes("timeout")) {
    return {
      category: "OPENAI_TIMEOUT",
      message: "Narrative generation timed out",
      recoverable: true,
      fallbackAvailable: true,
    };
  }

  if (message.includes("content_filter") || message.includes("content_policy")) {
    return {
      category: "OPENAI_CONTENT_FILTER",
      message: "Content generation blocked",
      recoverable: false,
      fallbackAvailable: true,
    };
  }

  return {
    category: "UNKNOWN",
    message: "An unexpected error occurred",
    recoverable: false,
    fallbackAvailable: true,
  };
}
```

---

## 7. Security Notes

### Server-Only Secrets

```typescript
// Environment variables (server-only)
// .env.local

# OpenAI - NEVER expose to client
OPENAI_API_KEY=sk-...

# Vercel KV - Server-only
KV_URL=...
KV_REST_API_URL=...
KV_REST_API_TOKEN=...
KV_REST_API_READ_ONLY_TOKEN=...

# Admin endpoints (if any)
ADMIN_SECRET=...
```

### Security Middleware

```typescript
// middleware.ts

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // Block direct access to internal routes
  if (request.nextUrl.pathname.startsWith("/api/internal/")) {
    const authHeader = request.headers.get("authorization");
    const expectedToken = process.env.ADMIN_SECRET;

    if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/internal/:path*",
};
```

### Client-Safe Data

The API responses contain NO:
- API keys
- Internal system information
- Raw error stack traces
- Database connection strings
- Server paths

All client-facing data is sanitized and type-safe.

---

## 8. Source Attribution

### Attribution Payload

```typescript
// lib/attribution.ts

export function getSourceAttribution(): SourceAttribution {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const lastModelRun = utcHour >= 18 ? "18z" : utcHour >= 12 ? "12z" : utcHour >= 6 ? "06z" : "00z";

  return {
    models: {
      day1: "NOAA HRRR (High Resolution Rapid Refresh, 3km resolution, hourly updates)",
      extended: "ECMWF (European Centre for Medium-Range Weather Forecasts)",
    },
    provider: "Open-Meteo Weather API (open-meteo.com)",
    riskAlgorithm: "Max Velocity proprietary scoring algorithm",
    lastModelRun,
    dataTimestamp: now.toISOString(),
  };
}
```

### UI Display Requirements

The frontend MUST display:
1. Model sources (HRRR for Day 1, ECMWF for Days 2-7)
2. Data provider (Open-Meteo)
3. Update timestamp
4. "Max Velocity Risk Score" branding

Example footer text:
```
Model Data: NOAA HRRR (Day 1), ECMWF (Days 2-7) via Open-Meteo
Risk Algorithm: Max Velocity proprietary scoring
Last Updated: December 30, 2024 6:00 PM ET
```

---

## Summary

This architecture provides:

1. **Authoritative Data** - Open-Meteo with explicit HRRR (Day 1) + ECMWF (Days 2-7) model selection
2. **No Number Invention** - OpenAI only generates narratives; all numbers come from Open-Meteo
3. **Transparent Risk Scoring** - Tunable, hazard-specific algorithm with clear thresholds
4. **Smart Caching** - Multi-layer (edge + KV) with change detection to minimize API calls
5. **Graceful Degradation** - Fallback to data-driven bullets if OpenAI fails
6. **Security** - All secrets server-only, sanitized client responses
7. **Attribution** - Clear source attribution in every response

*Document Version: 1.0*
*Created: December 2024*
