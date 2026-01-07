/**
 * Open-Meteo API client for weather data
 *
 * Uses NBM (National Blend of Models) for CONUS locations by default.
 * Falls back to auto model selection for non-CONUS (AK, HI, territories).
 */

export interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  precipitation: number[];
  rain: number[];
  snowfall: number[];
  wind_gusts_10m: number[];
  weather_code: number[];
}

export interface OpenMeteoDaily {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_sum: number[];
  rain_sum: number[];
  snowfall_sum: number[];
  wind_gusts_10m_max: number[];
  weather_code: number[];
}

export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly?: OpenMeteoHourly;
  daily?: OpenMeteoDaily;
}

// Use GFS endpoint for NBM CONUS support (customer endpoint if API key available)
// Note: NBM is only available on /v1/gfs endpoint, not /v1/forecast
const OPEN_METEO_BASE = process.env.OPEN_METEO_API_KEY
  ? 'https://customer-api.open-meteo.com/v1/gfs'
  : 'https://api.open-meteo.com/v1/gfs';

// Model configuration - defaults to NBM CONUS
// Valid values: ncep_nbm_conus, gfs_seamless, hrrr_conus, etc.
const OPENMETEO_MODEL = process.env.OPENMETEO_MODELS || 'ncep_nbm_conus';

// CONUS bounding box (Continental United States)
// Approximate bounds: lat 24.5°N to 49.5°N, lon -125°W to -66.5°W
const CONUS_BOUNDS = {
  minLat: 24.5,
  maxLat: 49.5,
  minLon: -125.0,
  maxLon: -66.5,
};

/**
 * Check if coordinates are within CONUS (Continental United States)
 * Returns false for Alaska, Hawaii, Puerto Rico, and other territories
 */
export function isWithinCONUS(lat: number, lon: number): boolean {
  return (
    lat >= CONUS_BOUNDS.minLat &&
    lat <= CONUS_BOUNDS.maxLat &&
    lon >= CONUS_BOUNDS.minLon &&
    lon <= CONUS_BOUNDS.maxLon
  );
}

/**
 * Get the appropriate model for a given location
 * Uses NBM for CONUS, falls back to gfs_seamless for non-CONUS
 */
function getModelForLocation(lat: number, lon: number): string {
  if (isWithinCONUS(lat, lon)) {
    return OPENMETEO_MODEL;
  }
  // For non-CONUS (AK, HI, territories), use gfs_seamless which has global coverage
  return 'gfs_seamless';
}

/**
 * Fetch weather data from Open-Meteo
 * Uses NBM model for CONUS locations, auto for non-CONUS
 */
export async function fetchOpenMeteoForecast(
  lat: number,
  lon: number,
  options: {
    hourly?: boolean;
    daily?: boolean;
    days?: number;
  } = {}
): Promise<OpenMeteoResponse> {
  const { hourly = true, daily = true, days = 7 } = options;

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    forecast_days: days.toString(),
  });

  // Add model selection (NBM for CONUS, GFS for non-CONUS)
  const model = getModelForLocation(lat, lon);
  params.append('models', model);

  // Add API key if available
  if (process.env.OPEN_METEO_API_KEY) {
    params.append('apikey', process.env.OPEN_METEO_API_KEY);
  }

  if (hourly) {
    params.append('hourly', 'temperature_2m,precipitation,rain,snowfall,wind_gusts_10m,weather_code');
  }

  if (daily) {
    params.append('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum,rain_sum,snowfall_sum,wind_gusts_10m_max,weather_code');
  }

  const url = `${OPEN_METEO_BASE}?${params}`;

  // Log URL in development for verification
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Open-Meteo] Fetching: ${url.replace(/apikey=[^&]+/, 'apikey=***')}`);
    console.log(`[Open-Meteo] Location: (${lat}, ${lon}) | CONUS: ${isWithinCONUS(lat, lon)} | Model: ${model || 'auto'}`);
  }

  const response = await fetch(url, {
    next: { revalidate: 600 }, // Cache for 10 minutes per spec
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error(`[Open-Meteo] API error ${response.status}: ${errorText}`);
    throw new Error(`Open-Meteo API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Fetch ensemble snow forecasts for uncertainty ranges
 */
export async function fetchEnsembleSnow(
  lat: number,
  lon: number,
  days: number = 7
): Promise<{ dates: string[]; snowRanges: { min: number; max: number; median: number }[] }> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lon.toString(),
    daily: 'snowfall_sum',
    precipitation_unit: 'inch',
    timezone: 'auto',
    forecast_days: days.toString(),
  });

  // Add API key if available
  if (process.env.OPEN_METEO_API_KEY) {
    params.append('apikey', process.env.OPEN_METEO_API_KEY);
  }

  // Use ensemble endpoint for uncertainty (customer endpoint if API key available)
  const ensembleBase = process.env.OPEN_METEO_API_KEY
    ? 'https://customer-ensemble-api.open-meteo.com/v1/ensemble'
    : 'https://ensemble-api.open-meteo.com/v1/ensemble';
  const response = await fetch(`${ensembleBase}?${params}&models=icon_seamless,gfs_seamless`, {
    next: { revalidate: 3600 },
  });

  if (!response.ok) {
    // Fall back to empty ranges
    return { dates: [], snowRanges: [] };
  }

  const data = await response.json();

  // Process ensemble members to get min/max/median
  const dates = data.daily?.time || [];
  const snowRanges = dates.map((_: string, i: number) => {
    const values: number[] = [];

    // Collect values from all ensemble members
    for (const key of Object.keys(data.daily)) {
      if (key.startsWith('snowfall_sum') && Array.isArray(data.daily[key])) {
        values.push(data.daily[key][i] || 0);
      }
    }

    if (values.length === 0) {
      return { min: 0, max: 0, median: 0 };
    }

    values.sort((a, b) => a - b);
    const min = values[0];
    const max = values[values.length - 1];
    const median = values[Math.floor(values.length / 2)];

    return { min, max, median };
  });

  return { dates, snowRanges };
}

/**
 * Convert weather code to condition string (legacy)
 */
export function weatherCodeToCondition(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly Cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 84) return 'Rain Showers';
  if (code <= 86) return 'Snow Showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

// Condition type for deterministic mapping
export type ConditionType =
  | 'sunny'
  | 'mostly-sunny'
  | 'partly-cloudy'
  | 'mostly-cloudy'
  | 'cloudy'
  | 'rain'
  | 'heavy-rain'
  | 'snow-showers'
  | 'heavy-snow'
  | 'storms'
  | 'isolated-storms'
  | 'scattered-storms'
  | 'sleet'
  | 'freezing-rain'
  | 'mixed-precip'
  | 'windy'
  | 'fog';

export interface DeterministicCondition {
  primary: ConditionType;
  secondary?: 'windy';
  label: string;
}

/**
 * Deterministically derive conditions from Open-Meteo weather data
 * This uses weather code, precipitation, snow, wind, and temperature values
 * NO AI involved - purely rule-based
 */
export function deriveCondition(params: {
  weatherCode: number;
  rainIn: number;
  snowIn: number;
  windGustMph: number;
  tempMinF: number;
  tempMaxF: number;
}): DeterministicCondition {
  const { weatherCode, rainIn, snowIn, windGustMph, tempMinF, tempMaxF } = params;

  // Determine if windy (secondary modifier)
  const isWindy = windGustMph >= 30;

  // Start with weather code classification
  let primary: ConditionType;
  let label: string;

  // Thunderstorms (code 95-99)
  if (weatherCode >= 95) {
    if (weatherCode === 99) {
      primary = 'storms';
      label = 'Storms';
    } else if (weatherCode >= 96) {
      primary = 'scattered-storms';
      label = 'Scattered Storms';
    } else {
      primary = 'isolated-storms';
      label = 'Isolated Storms';
    }
  }
  // Snow showers (code 85-86)
  else if (weatherCode >= 85 && weatherCode <= 86) {
    if (snowIn >= 6) {
      primary = 'heavy-snow';
      label = 'Heavy Snow';
    } else {
      primary = 'snow-showers';
      label = 'Snow Showers';
    }
  }
  // Rain showers (code 80-84)
  else if (weatherCode >= 80 && weatherCode <= 84) {
    if (rainIn >= 1.5) {
      primary = 'heavy-rain';
      label = 'Heavy Rain';
    } else {
      primary = 'rain';
      label = 'Rain';
    }
  }
  // Snow (code 71-77)
  else if (weatherCode >= 71 && weatherCode <= 77) {
    // Check for freezing rain / sleet conditions
    if (weatherCode === 77) {
      primary = 'sleet';
      label = 'Sleet';
    } else if (tempMinF <= 32 && rainIn > 0.1) {
      primary = 'freezing-rain';
      label = 'Freezing Rain';
    } else if (snowIn >= 6) {
      primary = 'heavy-snow';
      label = 'Heavy Snow';
    } else if (snowIn >= 0.5) {
      primary = 'snow-showers';
      label = 'Snow Showers';
    } else {
      primary = 'snow-showers';
      label = 'Snow Showers';
    }
  }
  // Rain (code 61-69)
  else if (weatherCode >= 61 && weatherCode <= 69) {
    // Check for mixed precip
    if (snowIn > 0.1 && rainIn > 0.1) {
      primary = 'mixed-precip';
      label = 'Mixed Precip';
    } else if (weatherCode >= 66) {
      // Freezing rain codes
      primary = 'freezing-rain';
      label = 'Freezing Rain';
    } else if (rainIn >= 1.5) {
      primary = 'heavy-rain';
      label = 'Heavy Rain';
    } else {
      primary = 'rain';
      label = 'Rain';
    }
  }
  // Drizzle (code 51-59)
  else if (weatherCode >= 51 && weatherCode <= 59) {
    if (weatherCode >= 56) {
      // Freezing drizzle
      primary = 'freezing-rain';
      label = 'Freezing Rain';
    } else {
      primary = 'rain';
      label = 'Rain';
    }
  }
  // Fog (code 45-49)
  else if (weatherCode >= 45 && weatherCode <= 49) {
    primary = 'fog';
    label = 'Fog';
  }
  // Cloudy conditions (code 1-3)
  else if (weatherCode === 3) {
    primary = 'cloudy';
    label = 'Cloudy';
  } else if (weatherCode === 2) {
    primary = 'mostly-cloudy';
    label = 'Mostly Cloudy';
  } else if (weatherCode === 1) {
    primary = 'partly-cloudy';
    label = 'Partly Cloudy';
  }
  // Clear (code 0)
  else {
    primary = 'sunny';
    label = 'Sunny';
  }

  // Override with precipitation-based conditions if significant precip but low weather code
  if (snowIn >= 6 && primary !== 'heavy-snow' && primary !== 'storms') {
    primary = 'heavy-snow';
    label = 'Heavy Snow';
  } else if (snowIn >= 0.5 && !['heavy-snow', 'snow-showers', 'sleet', 'mixed-precip', 'freezing-rain', 'storms'].includes(primary)) {
    primary = 'snow-showers';
    label = 'Snow Showers';
  } else if (rainIn >= 1.5 && !['heavy-rain', 'storms', 'scattered-storms', 'isolated-storms', 'snow-showers', 'heavy-snow', 'mixed-precip'].includes(primary)) {
    primary = 'heavy-rain';
    label = 'Heavy Rain';
  } else if (rainIn >= 0.25 && !['rain', 'heavy-rain', 'storms', 'scattered-storms', 'isolated-storms', 'snow-showers', 'heavy-snow', 'mixed-precip', 'freezing-rain', 'sleet'].includes(primary)) {
    primary = 'rain';
    label = 'Rain';
  }

  // Check for mixed precip
  if (snowIn > 0.1 && rainIn > 0.1 && !['storms', 'scattered-storms', 'isolated-storms'].includes(primary)) {
    primary = 'mixed-precip';
    label = 'Mixed Precip';
  }

  return {
    primary,
    secondary: isWindy ? 'windy' : undefined,
    label: isWindy ? `${label} & Windy` : label,
  };
}

/**
 * Get condition label for display
 */
export function getConditionLabel(condition: ConditionType): string {
  const labels: Record<ConditionType, string> = {
    'sunny': 'Sunny',
    'mostly-sunny': 'Mostly Sunny',
    'partly-cloudy': 'Partly Cloudy',
    'mostly-cloudy': 'Mostly Cloudy',
    'cloudy': 'Cloudy',
    'rain': 'Rain',
    'heavy-rain': 'Heavy Rain',
    'snow-showers': 'Snow Showers',
    'heavy-snow': 'Heavy Snow',
    'storms': 'Storms',
    'isolated-storms': 'Isolated Storms',
    'scattered-storms': 'Scattered Storms',
    'sleet': 'Sleet',
    'freezing-rain': 'Freezing Rain',
    'mixed-precip': 'Mixed Precip',
    'windy': 'Windy',
    'fog': 'Fog',
  };
  return labels[condition] || 'Unknown';
}
