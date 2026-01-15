/**
 * Model Registry - Maps Pivotal Weather model names to Open-Meteo API models
 *
 * Open-Meteo supported models:
 * - GFS, HRRR, NAM, NBM (US models)
 * - ECMWF IFS, AIFS (European)
 * - ICON, ICON-EU, ICON-D2 (German DWD)
 * - UKMO global, UKV (UK Met Office)
 * - GEM/GDPS, RDPS, HRDPS (Canadian)
 * - Ensemble models: GEFS, ECMWF EPS, ICON-EPS, etc.
 */

export type ModelCategory = 'global' | 'regional' | 'cam' | 'ensemble';

export interface ModelDefinition {
  id: string;
  name: string;
  shortName: string;
  category: ModelCategory;
  provider: string;
  description: string;
  resolution: string;
  forecastHours: number;
  updateInterval: number; // hours between runs
  runHours: number[]; // available run hours (UTC)
  openMeteoSupport: boolean;
  openMeteoModel?: string; // Open-Meteo API model parameter
  openMeteoApiEndpoint?: string; // specific API endpoint if different
  variables: string[]; // available variable groups
  maxZoom: number; // Maximum zoom before grid becomes too blocky
}

// Variable groups available in Open-Meteo
export const VARIABLE_GROUPS = {
  temperature: {
    name: 'Temperature',
    icon: '🌡️',
    variables: [
      { id: 'temperature_2m', name: '2m Temperature', unit: '°F' },
      { id: 'apparent_temperature', name: 'Feels Like', unit: '°F' },
      { id: 'temperature_850hPa', name: '850mb Temperature', unit: '°F' },
      { id: 'temperature_500hPa', name: '500mb Temperature', unit: '°F' },
    ]
  },
  moisture: {
    name: 'Moisture',
    icon: '💧',
    variables: [
      { id: 'relative_humidity_2m', name: '2m Relative Humidity', unit: '%' },
      { id: 'dew_point_2m', name: '2m Dew Point', unit: '°F' },
      { id: 'precipitable_water', name: 'PWAT', unit: 'in' },
    ]
  },
  wind: {
    name: 'Wind',
    icon: '💨',
    variables: [
      { id: 'wind_speed_10m', name: '10m Wind Speed', unit: 'mph' },
      { id: 'wind_gusts_10m', name: '10m Wind Gusts', unit: 'mph' },
      { id: 'wind_speed_850hPa', name: '850mb Wind', unit: 'mph' },
      { id: 'wind_speed_500hPa', name: '500mb Wind', unit: 'mph' },
      { id: 'wind_speed_250hPa', name: '250mb Wind (Jet)', unit: 'mph' },
    ]
  },
  precipitation: {
    name: 'Precipitation',
    icon: '🌧️',
    variables: [
      { id: 'precipitation', name: 'Total Precipitation', unit: 'in' },
      { id: 'rain', name: 'Rain', unit: 'in' },
      { id: 'snowfall', name: 'Snowfall', unit: 'in' },
      { id: 'snow_depth', name: 'Snow Depth', unit: 'in' },
    ]
  },
  severe: {
    name: 'Severe',
    icon: '⚡',
    variables: [
      { id: 'cape', name: 'CAPE', unit: 'J/kg' },
      { id: 'lifted_index', name: 'Lifted Index', unit: '' },
      { id: 'convective_inhibition', name: 'CIN', unit: 'J/kg' },
    ]
  },
  pressure: {
    name: 'Pressure',
    icon: '📊',
    variables: [
      { id: 'surface_pressure', name: 'Surface Pressure', unit: 'mb' },
      { id: 'pressure_msl', name: 'MSLP', unit: 'mb' },
      { id: 'geopotential_height_500hPa', name: '500mb Heights', unit: 'm' },
    ]
  },
  clouds: {
    name: 'Clouds',
    icon: '☁️',
    variables: [
      { id: 'cloud_cover', name: 'Total Cloud Cover', unit: '%' },
      { id: 'cloud_cover_low', name: 'Low Clouds', unit: '%' },
      { id: 'cloud_cover_mid', name: 'Mid Clouds', unit: '%' },
      { id: 'cloud_cover_high', name: 'High Clouds', unit: '%' },
    ]
  },
};

// Complete model registry
export const MODEL_REGISTRY: ModelDefinition[] = [
  // ==================== GLOBAL MODELS ====================
  {
    id: 'gfs',
    name: 'GFS',
    shortName: 'GFS',
    category: 'global',
    provider: 'NOAA/NCEP',
    description: 'Global Forecast System - Primary US global model',
    resolution: '0.25° (~28km)',
    forecastHours: 384,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'gfs_seamless',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'severe', 'pressure', 'clouds'],
    maxZoom: 6,
  },
  {
    id: 'ecmwf',
    name: 'ECMWF IFS',
    shortName: 'ECMWF',
    category: 'global',
    provider: 'ECMWF',
    description: 'European Centre global model - High accuracy',
    resolution: '0.1° (~11km)',
    forecastHours: 240,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'ecmwf_ifs',
    openMeteoApiEndpoint: 'ecmwf',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'pressure', 'clouds'],
    maxZoom: 7,
  },
  {
    id: 'ecmwf_aifs',
    name: 'ECMWF AIFS',
    shortName: 'AIFS',
    category: 'global',
    provider: 'ECMWF',
    description: 'AI-enhanced ECMWF forecast',
    resolution: '0.25° (~28km)',
    forecastHours: 240,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'ecmwf_aifs',
    openMeteoApiEndpoint: 'ecmwf',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'pressure'],
    maxZoom: 6,
  },
  {
    id: 'icon_global',
    name: 'ICON Global',
    shortName: 'ICON',
    category: 'global',
    provider: 'DWD',
    description: 'German Weather Service global model',
    resolution: '0.125° (~13km)',
    forecastHours: 180,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'icon_global',
    openMeteoApiEndpoint: 'dwd-icon',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'severe', 'pressure', 'clouds'],
    maxZoom: 7,
  },
  {
    id: 'gdps',
    name: 'GDPS (GEM)',
    shortName: 'GDPS',
    category: 'global',
    provider: 'ECCC',
    description: 'Canadian Global Deterministic Prediction System',
    resolution: '0.15° (~15km)',
    forecastHours: 240,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: true,
    openMeteoModel: 'gem_global',
    openMeteoApiEndpoint: 'gem',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'pressure', 'clouds'],
    maxZoom: 7,
  },
  {
    id: 'ukmo_global',
    name: 'UKMO Global',
    shortName: 'UKMET',
    category: 'global',
    provider: 'UK Met Office',
    description: 'UK Met Office global model',
    resolution: '0.09° (~10km)',
    forecastHours: 168,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'ukmo_global_deterministic_10km',
    openMeteoApiEndpoint: 'ukmo',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'pressure', 'clouds'],
    maxZoom: 8,
  },
  {
    id: 'cfs',
    name: 'CFS',
    shortName: 'CFS',
    category: 'global',
    provider: 'NOAA/NCEP',
    description: 'Climate Forecast System - Long range',
    resolution: '0.5° (~56km)',
    forecastHours: 9 * 30 * 24, // 9 months
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: false, // Not available in Open-Meteo
    variables: ['temperature', 'precipitation'],
    maxZoom: 5,
  },
  {
    id: 'gfs_graphcast',
    name: 'AI GFS (GraphCast)',
    shortName: 'AIGFS',
    category: 'global',
    provider: 'NOAA',
    description: 'AI-enhanced GFS using GraphCast',
    resolution: '0.25° (~28km)',
    forecastHours: 240,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: false, // Not directly available
    variables: ['temperature', 'wind', 'precipitation'],
    maxZoom: 6,
  },

  // ==================== REGIONAL MODELS ====================
  {
    id: 'nam',
    name: 'NAM',
    shortName: 'NAM',
    category: 'regional',
    provider: 'NOAA/NCEP',
    description: 'North American Mesoscale - CONUS regional',
    resolution: '12km',
    forecastHours: 84,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'gfs_seamless', // NAM data incorporated
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'severe', 'pressure', 'clouds'],
    maxZoom: 8,
  },
  {
    id: 'rap',
    name: 'RAP',
    shortName: 'RAP',
    category: 'regional',
    provider: 'NOAA/NCEP',
    description: 'Rapid Refresh - Hourly updates',
    resolution: '13km',
    forecastHours: 21,
    updateInterval: 1,
    runHours: Array.from({ length: 24 }, (_, i) => i),
    openMeteoSupport: false, // Not directly in Open-Meteo
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'severe'],
    maxZoom: 8,
  },
  {
    id: 'rdps',
    name: 'RDPS',
    shortName: 'RDPS',
    category: 'regional',
    provider: 'ECCC',
    description: 'Canadian Regional Deterministic Prediction System',
    resolution: '10km',
    forecastHours: 84,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'gem_regional',
    openMeteoApiEndpoint: 'gem',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'pressure', 'clouds'],
    maxZoom: 8,
  },
  {
    id: 'icon_eu',
    name: 'ICON-EU',
    shortName: 'ICON-EU',
    category: 'regional',
    provider: 'DWD',
    description: 'ICON Europe nest',
    resolution: '0.0625° (~7km)',
    forecastHours: 120,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'icon_eu',
    openMeteoApiEndpoint: 'dwd-icon',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'severe', 'pressure', 'clouds'],
    maxZoom: 9,
  },

  // ==================== CAM (Convection-Allowing Models) ====================
  {
    id: 'hrrr',
    name: 'HRRR',
    shortName: 'HRRR',
    category: 'cam',
    provider: 'NOAA/NCEP',
    description: 'High-Resolution Rapid Refresh - Hourly CONUS CAM',
    resolution: '3km',
    forecastHours: 48,
    updateInterval: 1,
    runHours: Array.from({ length: 24 }, (_, i) => i),
    openMeteoSupport: true,
    openMeteoModel: 'gfs_hrrr',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'severe', 'pressure', 'clouds'],
    maxZoom: 10,
  },
  {
    id: 'nam_3km',
    name: 'NAM 3km',
    shortName: 'NAM3km',
    category: 'cam',
    provider: 'NOAA/NCEP',
    description: 'NAM CONUS Nest - 3km resolution',
    resolution: '3km',
    forecastHours: 60,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: false, // Not in Open-Meteo
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'severe'],
    maxZoom: 10,
  },
  {
    id: 'hrdps',
    name: 'HRDPS',
    shortName: 'HRDPS',
    category: 'cam',
    provider: 'ECCC',
    description: 'High Resolution Deterministic Prediction System',
    resolution: '2.5km',
    forecastHours: 48,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'gem_hrdps_continental',
    openMeteoApiEndpoint: 'gem',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'pressure', 'clouds'],
    maxZoom: 10,
  },
  {
    id: 'icon_d2',
    name: 'ICON-D2',
    shortName: 'ICON-D2',
    category: 'cam',
    provider: 'DWD',
    description: 'ICON Germany nest - 2km',
    resolution: '2km',
    forecastHours: 48,
    updateInterval: 3,
    runHours: [0, 3, 6, 9, 12, 15, 18, 21],
    openMeteoSupport: true,
    openMeteoModel: 'icon_d2',
    openMeteoApiEndpoint: 'dwd-icon',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'severe', 'pressure', 'clouds'],
    maxZoom: 11,
  },
  {
    id: 'hrw_arw',
    name: 'HRW WRF-ARW',
    shortName: 'HRW-ARW',
    category: 'cam',
    provider: 'NOAA/EMC',
    description: 'HIRESW ARW Member',
    resolution: '3km',
    forecastHours: 48,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: false,
    variables: ['temperature', 'precipitation', 'severe'],
    maxZoom: 10,
  },
  {
    id: 'hrw_nssl',
    name: 'HRW WRF-NSSL',
    shortName: 'HRW-NSSL',
    category: 'cam',
    provider: 'NOAA/EMC',
    description: 'HIRESW NSSL-WRF Member',
    resolution: '3km',
    forecastHours: 48,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: false,
    variables: ['temperature', 'precipitation', 'severe'],
    maxZoom: 10,
  },
  {
    id: 'hrw_fv3',
    name: 'HRW FV3',
    shortName: 'HRW-FV3',
    category: 'cam',
    provider: 'NOAA/EMC',
    description: 'HIRESW FV3 Member',
    resolution: '3km',
    forecastHours: 48,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: false,
    variables: ['temperature', 'precipitation', 'severe'],
    maxZoom: 10,
  },
  {
    id: 'rrfs_a',
    name: 'RRFS-A',
    shortName: 'RRFS-A',
    category: 'cam',
    provider: 'NOAA/EMC',
    description: 'Rapid Refresh Forecast System - Analysis',
    resolution: '3km',
    forecastHours: 60,
    updateInterval: 1,
    runHours: Array.from({ length: 24 }, (_, i) => i),
    openMeteoSupport: false,
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'severe'],
    maxZoom: 10,
  },
  {
    id: 'gsl_mpas',
    name: 'GSL MPAS-G',
    shortName: 'MPAS-G',
    category: 'cam',
    provider: 'NOAA/GSL',
    description: 'Global-nested MPAS from GSL',
    resolution: '3km (CONUS)',
    forecastHours: 60,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: false,
    variables: ['temperature', 'precipitation', 'severe'],
    maxZoom: 10,
  },
  {
    id: 'nssl_mpas_htpo',
    name: 'NSSL MPAS-HTPO',
    shortName: 'MPAS-HTPO',
    category: 'cam',
    provider: 'NSSL',
    description: 'NSSL MPAS with Thompson aerosol-aware microphysics',
    resolution: '3km',
    forecastHours: 48,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: false,
    variables: ['temperature', 'precipitation', 'severe'],
    maxZoom: 10,
  },
  {
    id: 'nssl_mpas_rn',
    name: 'NSSL MPAS-RN',
    shortName: 'MPAS-RN',
    category: 'cam',
    provider: 'NSSL',
    description: 'NSSL MPAS Regional-Nested',
    resolution: '3km',
    forecastHours: 48,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: false,
    variables: ['temperature', 'precipitation', 'severe'],
    maxZoom: 10,
  },
  {
    id: 'nssl_mpas_rn3',
    name: 'NSSL MPAS-RN3',
    shortName: 'MPAS-RN3',
    category: 'cam',
    provider: 'NSSL',
    description: 'NSSL MPAS Regional-Nested 3km',
    resolution: '3km',
    forecastHours: 48,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: false,
    variables: ['temperature', 'precipitation', 'severe'],
    maxZoom: 10,
  },

  // ==================== ENSEMBLE MODELS ====================
  {
    id: 'gefs',
    name: 'GEFS',
    shortName: 'GEFS',
    category: 'ensemble',
    provider: 'NOAA/NCEP',
    description: 'Global Ensemble Forecast System - 31 members',
    resolution: '0.25° (~28km)',
    forecastHours: 384,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'gfs_seamless', // Ensemble data available
    openMeteoApiEndpoint: 'ensemble',
    variables: ['temperature', 'precipitation', 'wind'],
    maxZoom: 6,
  },
  {
    id: 'ecmwf_eps',
    name: 'ECMWF EPS',
    shortName: 'EPS',
    category: 'ensemble',
    provider: 'ECMWF',
    description: 'ECMWF Ensemble - 51 members',
    resolution: '0.25° (~28km)',
    forecastHours: 360,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'ecmwf_ifs',
    openMeteoApiEndpoint: 'ensemble',
    variables: ['temperature', 'precipitation', 'wind'],
    maxZoom: 6,
  },
  {
    id: 'eps_opendata',
    name: 'EPS (OpenData)',
    shortName: 'EPS-OD',
    category: 'ensemble',
    provider: 'ECMWF',
    description: 'ECMWF Ensemble Open Data subset',
    resolution: '0.4° (~44km)',
    forecastHours: 240,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: true,
    openMeteoModel: 'ecmwf_ifs',
    openMeteoApiEndpoint: 'ensemble',
    variables: ['temperature', 'precipitation', 'wind'],
    maxZoom: 5,
  },
  {
    id: 'eps_aifs',
    name: 'EPS-AIFS',
    shortName: 'EPS-AIFS',
    category: 'ensemble',
    provider: 'ECMWF',
    description: 'ECMWF AI Ensemble',
    resolution: '0.25° (~28km)',
    forecastHours: 240,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: false, // Not yet available
    variables: ['temperature', 'precipitation'],
    maxZoom: 6,
  },
  {
    id: 'icon_eps',
    name: 'ICON-EPS',
    shortName: 'ICON-EPS',
    category: 'ensemble',
    provider: 'DWD',
    description: 'ICON Global Ensemble - 40 members',
    resolution: '0.25° (~28km)',
    forecastHours: 180,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: true,
    openMeteoModel: 'icon_seamless',
    openMeteoApiEndpoint: 'ensemble',
    variables: ['temperature', 'precipitation', 'wind'],
    maxZoom: 6,
  },
  {
    id: 'cmce',
    name: 'CMCE (GEPS)',
    shortName: 'CMCE',
    category: 'ensemble',
    provider: 'ECCC',
    description: 'Canadian Global Ensemble - 21 members',
    resolution: '0.5° (~50km)',
    forecastHours: 384,
    updateInterval: 12,
    runHours: [0, 12],
    openMeteoSupport: true,
    openMeteoModel: 'gem_global',
    openMeteoApiEndpoint: 'ensemble',
    variables: ['temperature', 'precipitation', 'wind'],
    maxZoom: 5,
  },
  {
    id: 'mogreps_g',
    name: 'MOGREPS-G',
    shortName: 'MOGREPS',
    category: 'ensemble',
    provider: 'UK Met Office',
    description: 'UK Met Office Global Ensemble',
    resolution: '0.2° (~22km)',
    forecastHours: 168,
    updateInterval: 6,
    runHours: [0, 6, 12, 18],
    openMeteoSupport: false, // Not in Open-Meteo
    variables: ['temperature', 'precipitation', 'wind'],
    maxZoom: 6,
  },
  {
    id: 'sref',
    name: 'SREF',
    shortName: 'SREF',
    category: 'ensemble',
    provider: 'NOAA/NCEP',
    description: 'Short-Range Ensemble Forecast',
    resolution: '16km',
    forecastHours: 87,
    updateInterval: 6,
    runHours: [3, 9, 15, 21],
    openMeteoSupport: false, // Not in Open-Meteo
    variables: ['temperature', 'precipitation', 'severe'],
    maxZoom: 8,
  },
  {
    id: 'nbm',
    name: 'NBM',
    shortName: 'NBM',
    category: 'ensemble',
    provider: 'NOAA/NWS',
    description: 'National Blend of Models - Consensus guidance',
    resolution: '2.5km (CONUS)',
    forecastHours: 264,
    updateInterval: 1,
    runHours: Array.from({ length: 24 }, (_, i) => i),
    openMeteoSupport: true,
    openMeteoModel: 'ncep_nbm_conus',
    openMeteoApiEndpoint: 'forecast',
    variables: ['temperature', 'moisture', 'wind', 'precipitation', 'clouds'],
    maxZoom: 10,
  },
];

// Helper functions
export function getModelById(id: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find(m => m.id === id);
}

export function getModelsByCategory(category: ModelCategory): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.category === category);
}

export function getSupportedModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => m.openMeteoSupport);
}

export function getUnsupportedModels(): ModelDefinition[] {
  return MODEL_REGISTRY.filter(m => !m.openMeteoSupport);
}

// Get the last N runs for a model
export function getModelRuns(model: ModelDefinition, count: number = 4): { runHour: number; timestamp: Date; label: string }[] {
  const now = new Date();
  const currentHour = now.getUTCHours();

  // Find the most recent run
  const sortedRuns = [...model.runHours].sort((a, b) => b - a);

  const runs: { runHour: number; timestamp: Date; label: string }[] = [];
  let currentDate = new Date(now);
  currentDate.setUTCMinutes(0, 0, 0);

  // Go back in time to find runs
  for (let dayOffset = 0; runs.length < count && dayOffset < 7; dayOffset++) {
    for (const runHour of sortedRuns) {
      if (runs.length >= count) break;

      const runDate = new Date(currentDate);
      runDate.setUTCDate(runDate.getUTCDate() - dayOffset);
      runDate.setUTCHours(runHour, 0, 0, 0);

      // Skip future runs
      if (runDate > now) continue;

      // Assume data is available ~3-4 hours after run time
      const availableTime = new Date(runDate.getTime() + 4 * 60 * 60 * 1000);
      if (availableTime > now) continue;

      runs.push({
        runHour,
        timestamp: runDate,
        label: `${runHour.toString().padStart(2, '0')}Z`,
      });
    }
  }

  return runs;
}

// Color scales for different variables
export const COLOR_SCALES = {
  temperature: {
    // Purple/blue (cold) -> cyan -> green -> yellow -> orange -> red (hot)
    stops: [
      { value: -40, color: [128, 0, 128] },   // Purple
      { value: -20, color: [75, 0, 130] },    // Indigo
      { value: 0, color: [0, 0, 255] },       // Blue
      { value: 20, color: [0, 191, 255] },    // Deep sky blue
      { value: 32, color: [0, 255, 255] },    // Cyan
      { value: 50, color: [0, 255, 0] },      // Green
      { value: 70, color: [255, 255, 0] },    // Yellow
      { value: 85, color: [255, 165, 0] },    // Orange
      { value: 100, color: [255, 0, 0] },     // Red
      { value: 115, color: [139, 0, 0] },     // Dark red
    ]
  },
  precipitation: {
    stops: [
      { value: 0, color: [255, 255, 255, 0] },
      { value: 0.01, color: [200, 230, 200] },
      { value: 0.1, color: [150, 200, 150] },
      { value: 0.25, color: [100, 180, 100] },
      { value: 0.5, color: [50, 150, 50] },
      { value: 1.0, color: [0, 100, 0] },
      { value: 2.0, color: [255, 255, 0] },
      { value: 4.0, color: [255, 165, 0] },
      { value: 8.0, color: [255, 0, 0] },
    ]
  },
  wind: {
    stops: [
      { value: 0, color: [255, 255, 255] },
      { value: 10, color: [200, 230, 255] },
      { value: 20, color: [100, 180, 255] },
      { value: 30, color: [50, 130, 255] },
      { value: 40, color: [0, 80, 255] },
      { value: 60, color: [255, 255, 0] },
      { value: 80, color: [255, 165, 0] },
      { value: 100, color: [255, 0, 0] },
    ]
  },
  cape: {
    stops: [
      { value: 0, color: [255, 255, 255, 0] },
      { value: 100, color: [200, 220, 255] },
      { value: 500, color: [150, 200, 255] },
      { value: 1000, color: [100, 255, 100] },
      { value: 2000, color: [255, 255, 0] },
      { value: 3000, color: [255, 165, 0] },
      { value: 4000, color: [255, 0, 0] },
      { value: 5000, color: [200, 0, 100] },
    ]
  },
};
