// Fetch weather data from Open-Meteo API using HRRR for Day 1, ECMWF for Days 2-7
// HRRR = High Resolution Rapid Refresh (hourly updates, 3km resolution for US)
// ECMWF = European Centre for Medium-Range Weather Forecasts (best global model)

interface CurrentConditions {
  temperature: number;
  apparentTemperature: number;
  relativeHumidity: number;
  precipitation: number;
  rain: number;
  snowfall: number;
  weatherCode: number;
  cloudCover: number;
  pressure: number;
  windSpeed: number;
  windDirection: number;
  windGusts: number;
  visibility: number;
  dewPoint: number;
}

interface HourlyData {
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
  wind_gusts_10m: number[];
  cape: number[];
}

interface DailyData {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  apparent_temperature_max: number[];
  apparent_temperature_min: number[];
  precipitation_sum: number[];
  rain_sum: number[];
  snowfall_sum: number[];
  precipitation_probability_max: number[];
  wind_speed_10m_max: number[];
  wind_gusts_10m_max: number[];
}

interface CityForecast {
  city: string;
  state: string;
  region: string;
  lat: number;
  lon: number;
  // Current conditions snapshot
  current: CurrentConditions | null;
  // Day 1 - HRRR hourly data aggregated
  day1: {
    tempHigh: number;
    tempLow: number;
    feelsLikeHigh: number;
    feelsLikeLow: number;
    totalPrecip: number;
    totalRain: number;
    totalSnow: number;
    maxSnowDepth: number;
    maxWindSpeed: number;
    maxWindGusts: number;
    maxCape: number;
    minVisibility: number;
    avgCloudCover: number;
    dominantWeatherCode: number;
    hourlyHighlights: string[];
  };
  // Days 2-7 - ECMWF daily data
  extendedDays: {
    date: string;
    dayNumber: number;
    tempHigh: number;
    tempLow: number;
    feelsLikeHigh: number;
    feelsLikeLow: number;
    totalPrecip: number;
    totalRain: number;
    totalSnow: number;
    precipProbability: number;
    maxWindSpeed: number;
    maxWindGusts: number;
    weatherCode: number;
  }[];
}

interface RegionCurrentSnapshot {
  tempRange: { min: number; max: number; avg: number };
  feelsLikeRange: { min: number; max: number };
  dewPointRange: { min: number; max: number };
  humidityRange: { min: number; max: number };
  pressureRange: { min: number; max: number };
  windSpeedMax: number;
  windGustsMax: number;
  visibilityMin: number;
  dominantConditions: string[];
  activePrecip: { city: string; type: string; rate: number }[];
  coldestCity: { name: string; temp: number };
  warmestCity: { name: string; temp: number };
  windiestCity: { name: string; gusts: number };
}

interface RegionSummary {
  regionId: string;
  regionName: string;
  states: string[];
  cityCount: number;
  currentSnapshot: RegionCurrentSnapshot;
  day1: {
    tempRange: { min: number; max: number; avg: number };
    feelsLikeRange: { min: number; max: number };
    totalPrecipRange: { min: number; max: number };
    totalSnowRange: { min: number; max: number };
    maxSnowDepth: number;
    windGustsMax: number;
    maxCape: number;
    minVisibility: number;
    dominantConditions: string[];
    citiesWithSnow: string[];
    citiesWithRain: string[];
    citiesWithHighWind: string[];
    coldestCity: { name: string; temp: number };
    warmestCity: { name: string; temp: number };
  };
  extendedDays: {
    dayNumber: number;
    date: string;
    tempRange: { min: number; max: number };
    totalPrecipRange: { min: number; max: number };
    totalSnowRange: { min: number; max: number };
    maxWindGusts: number;
    dominantConditions: string[];
  }[];
  cityForecasts: CityForecast[];
}

// Representative locations for each region - cities PLUS geographic sampling points
// Includes lake-effect zones, mountain areas, rural regions for comprehensive coverage
const REGION_CITIES: Record<string, { name: string; state: string; lat: number; lon: number }[]> = {
  west_coast: [
    // Major cities
    { name: "Seattle", state: "WA", lat: 47.61, lon: -122.33 },
    { name: "Portland", state: "OR", lat: 45.52, lon: -122.68 },
    { name: "San Francisco", state: "CA", lat: 37.77, lon: -122.42 },
    { name: "Los Angeles", state: "CA", lat: 34.05, lon: -118.24 },
    { name: "San Diego", state: "CA", lat: 32.72, lon: -117.16 },
    { name: "Sacramento", state: "CA", lat: 38.58, lon: -121.49 },
    { name: "Phoenix", state: "AZ", lat: 33.45, lon: -112.07 },
    { name: "Las Vegas", state: "NV", lat: 36.17, lon: -115.14 },
    { name: "Salt Lake City", state: "UT", lat: 40.76, lon: -111.89 },
    { name: "Boise", state: "ID", lat: 43.62, lon: -116.21 },
    // Geographic sampling - mountains, coast, rural
    { name: "Sierra Nevada (Tahoe)", state: "CA", lat: 39.09, lon: -120.03 },
    { name: "Cascades (Mt Hood)", state: "OR", lat: 45.37, lon: -121.70 },
    { name: "Olympic Peninsula", state: "WA", lat: 47.80, lon: -123.50 },
    { name: "Central Valley (Fresno)", state: "CA", lat: 36.75, lon: -119.77 },
    { name: "Wasatch Mountains", state: "UT", lat: 40.60, lon: -111.60 },
    { name: "Flagstaff (N Arizona)", state: "AZ", lat: 35.20, lon: -111.65 },
  ],
  rockies: [
    // Major cities
    { name: "Denver", state: "CO", lat: 39.74, lon: -104.99 },
    { name: "Colorado Springs", state: "CO", lat: 38.83, lon: -104.82 },
    { name: "Albuquerque", state: "NM", lat: 35.08, lon: -106.65 },
    { name: "Santa Fe", state: "NM", lat: 35.69, lon: -105.94 },
    { name: "Cheyenne", state: "WY", lat: 41.14, lon: -104.82 },
    { name: "Casper", state: "WY", lat: 42.87, lon: -106.31 },
    { name: "Billings", state: "MT", lat: 45.78, lon: -108.50 },
    { name: "Bozeman", state: "MT", lat: 45.68, lon: -111.04 },
    { name: "Missoula", state: "MT", lat: 46.87, lon: -114.00 },
    // Geographic sampling - high mountains, passes
    { name: "Vail/I-70 Corridor", state: "CO", lat: 39.64, lon: -106.37 },
    { name: "Steamboat Springs", state: "CO", lat: 40.48, lon: -106.83 },
    { name: "Jackson Hole", state: "WY", lat: 43.48, lon: -110.76 },
    { name: "Yellowstone Region", state: "WY", lat: 44.43, lon: -110.59 },
    { name: "Glacier Park Area", state: "MT", lat: 48.70, lon: -113.80 },
    { name: "Taos/Sangre de Cristo", state: "NM", lat: 36.41, lon: -105.57 },
  ],
  great_plains: [
    // Major cities
    { name: "Dallas", state: "TX", lat: 32.78, lon: -96.80 },
    { name: "Houston", state: "TX", lat: 29.76, lon: -95.37 },
    { name: "San Antonio", state: "TX", lat: 29.42, lon: -98.49 },
    { name: "Austin", state: "TX", lat: 30.27, lon: -97.74 },
    { name: "Oklahoma City", state: "OK", lat: 35.47, lon: -97.52 },
    { name: "Tulsa", state: "OK", lat: 36.15, lon: -95.99 },
    { name: "Kansas City", state: "KS", lat: 39.10, lon: -94.58 },
    { name: "Wichita", state: "KS", lat: 37.69, lon: -97.34 },
    { name: "Omaha", state: "NE", lat: 41.26, lon: -95.94 },
    { name: "Fargo", state: "ND", lat: 46.88, lon: -96.79 },
    { name: "Sioux Falls", state: "SD", lat: 43.55, lon: -96.73 },
    { name: "New Orleans", state: "LA", lat: 29.95, lon: -90.07 },
    // Geographic sampling - tornado alley, panhandles, rural
    { name: "Texas Panhandle (Amarillo)", state: "TX", lat: 35.22, lon: -101.83 },
    { name: "Oklahoma Panhandle", state: "OK", lat: 36.75, lon: -101.50 },
    { name: "Western Kansas", state: "KS", lat: 38.50, lon: -100.50 },
    { name: "Nebraska Sandhills", state: "NE", lat: 42.00, lon: -101.00 },
    { name: "Black Hills (Rapid City)", state: "SD", lat: 44.08, lon: -103.23 },
    { name: "Red River Valley", state: "ND", lat: 47.50, lon: -97.00 },
  ],
  midwest: [
    // Major cities
    { name: "Chicago", state: "IL", lat: 41.88, lon: -87.63 },
    { name: "Detroit", state: "MI", lat: 42.33, lon: -83.05 },
    { name: "Grand Rapids", state: "MI", lat: 42.96, lon: -85.66 },
    { name: "Minneapolis", state: "MN", lat: 44.98, lon: -93.27 },
    { name: "Cleveland", state: "OH", lat: 41.50, lon: -81.69 },
    { name: "Columbus", state: "OH", lat: 39.96, lon: -83.00 },
    { name: "Cincinnati", state: "OH", lat: 39.10, lon: -84.51 },
    { name: "Indianapolis", state: "IN", lat: 39.77, lon: -86.16 },
    { name: "Milwaukee", state: "WI", lat: 43.04, lon: -87.91 },
    { name: "Madison", state: "WI", lat: 43.07, lon: -89.40 },
    { name: "Des Moines", state: "IA", lat: 41.59, lon: -93.62 },
    { name: "St. Louis", state: "MO", lat: 38.63, lon: -90.20 },
    // Lake-effect zones and geographic sampling
    { name: "Lake Michigan Shore (Muskegon)", state: "MI", lat: 43.23, lon: -86.25 },
    { name: "Upper Peninsula", state: "MI", lat: 46.50, lon: -87.40 },
    { name: "NE Ohio Snowbelt", state: "OH", lat: 41.70, lon: -81.20 },
    { name: "Northern Wisconsin", state: "WI", lat: 45.80, lon: -89.70 },
    { name: "Northern Minnesota", state: "MN", lat: 47.50, lon: -94.50 },
    { name: "Southern Illinois", state: "IL", lat: 37.80, lon: -89.00 },
  ],
  northeast: [
    // Major cities
    { name: "New York City", state: "NY", lat: 40.71, lon: -74.01 },
    { name: "Buffalo", state: "NY", lat: 42.89, lon: -78.88 },
    { name: "Rochester", state: "NY", lat: 43.16, lon: -77.61 },
    { name: "Syracuse", state: "NY", lat: 43.05, lon: -76.15 },
    { name: "Albany", state: "NY", lat: 42.65, lon: -73.76 },
    { name: "Boston", state: "MA", lat: 42.36, lon: -71.06 },
    { name: "Philadelphia", state: "PA", lat: 39.95, lon: -75.17 },
    { name: "Pittsburgh", state: "PA", lat: 40.44, lon: -80.00 },
    { name: "Burlington", state: "VT", lat: 44.48, lon: -73.21 },
    { name: "Portland", state: "ME", lat: 43.66, lon: -70.26 },
    // Lake-effect and geographic sampling
    { name: "Tug Hill Plateau", state: "NY", lat: 43.75, lon: -75.50 },
    { name: "Watertown/Lake Ontario", state: "NY", lat: 43.97, lon: -75.91 },
    { name: "Southern Tier NY", state: "NY", lat: 42.10, lon: -76.80 },
    { name: "Catskills", state: "NY", lat: 42.10, lon: -74.30 },
    { name: "Adirondacks", state: "NY", lat: 44.00, lon: -74.20 },
    { name: "White Mountains", state: "NH", lat: 44.27, lon: -71.30 },
    { name: "Berkshires", state: "MA", lat: 42.45, lon: -73.25 },
    { name: "Central PA (State College)", state: "PA", lat: 40.79, lon: -77.86 },
    { name: "NE Pennsylvania (Scranton)", state: "PA", lat: 41.41, lon: -75.66 },
    { name: "Cape Cod", state: "MA", lat: 41.70, lon: -70.30 },
    { name: "Northern Maine", state: "ME", lat: 46.50, lon: -68.50 },
  ],
  southeast: [
    // Major cities
    { name: "Atlanta", state: "GA", lat: 33.75, lon: -84.39 },
    { name: "Miami", state: "FL", lat: 25.76, lon: -80.19 },
    { name: "Tampa", state: "FL", lat: 27.95, lon: -82.46 },
    { name: "Orlando", state: "FL", lat: 28.54, lon: -81.38 },
    { name: "Jacksonville", state: "FL", lat: 30.33, lon: -81.66 },
    { name: "Charlotte", state: "NC", lat: 35.23, lon: -80.84 },
    { name: "Raleigh", state: "NC", lat: 35.78, lon: -78.64 },
    { name: "Nashville", state: "TN", lat: 36.16, lon: -86.78 },
    { name: "Memphis", state: "TN", lat: 35.15, lon: -90.05 },
    { name: "Birmingham", state: "AL", lat: 33.52, lon: -86.80 },
    { name: "Washington DC", state: "DC", lat: 38.91, lon: -77.04 },
    { name: "Richmond", state: "VA", lat: 37.54, lon: -77.44 },
    // Geographic sampling - mountains, coast, rural
    { name: "Blue Ridge (Asheville)", state: "NC", lat: 35.60, lon: -82.55 },
    { name: "Appalachian VA", state: "VA", lat: 37.00, lon: -81.50 },
    { name: "Shenandoah Valley", state: "VA", lat: 38.50, lon: -78.90 },
    { name: "Eastern Kentucky", state: "KY", lat: 37.50, lon: -83.50 },
    { name: "WV Mountains", state: "WV", lat: 38.80, lon: -80.00 },
    { name: "Florida Panhandle", state: "FL", lat: 30.40, lon: -86.60 },
    { name: "Outer Banks", state: "NC", lat: 35.90, lon: -75.60 },
  ],
};

const REGION_INFO: Record<string, { name: string; states: string[] }> = {
  west_coast: {
    name: "West Coast",
    states: ["California", "Oregon", "Washington", "Idaho", "Nevada", "Arizona", "Utah"]
  },
  rockies: {
    name: "Rockies",
    states: ["Colorado", "Wyoming", "Montana", "New Mexico"]
  },
  great_plains: {
    name: "Great Plains",
    states: ["Texas", "Oklahoma", "Kansas", "Nebraska", "North Dakota", "South Dakota", "Louisiana", "Arkansas"]
  },
  midwest: {
    name: "Midwest",
    states: ["Minnesota", "Iowa", "Missouri", "Illinois", "Indiana", "Ohio", "Michigan", "Wisconsin"]
  },
  northeast: {
    name: "Northeast",
    states: ["New York", "Pennsylvania", "New Jersey", "Massachusetts", "Connecticut", "Rhode Island", "Vermont", "New Hampshire", "Maine"]
  },
  southeast: {
    name: "Southeast",
    states: ["Florida", "Georgia", "Alabama", "Tennessee", "Kentucky", "North Carolina", "South Carolina", "Virginia", "West Virginia", "Maryland", "Delaware", "DC"]
  },
};

// Weather code descriptions (WMO codes)
const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

function getWeatherDescription(code: number): string {
  return WEATHER_CODES[code] || "Unknown";
}

// Calculate dew point from temperature and relative humidity
function calculateDewPoint(tempF: number, rh: number): number {
  // Convert to Celsius for calculation
  const tempC = (tempF - 32) * 5 / 9;
  // Magnus formula approximation
  const a = 17.27;
  const b = 237.7;
  const alpha = ((a * tempC) / (b + tempC)) + Math.log(rh / 100);
  const dewPointC = (b * alpha) / (a - alpha);
  // Convert back to Fahrenheit
  return Math.round((dewPointC * 9 / 5) + 32);
}

// Fetch current conditions using Open-Meteo GFS/HRRR blend + recent hourly for context
async function fetchCurrentConditions(city: { name: string; state: string; lat: number; lon: number }): Promise<CurrentConditions | null> {
  try {
    // Get current conditions plus last 3 hours for precipitation context
    const url = `https://api.open-meteo.com/v1/gfs?latitude=${city.lat}&longitude=${city.lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,snowfall,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility` +
      `&hourly=precipitation,rain,snowfall,visibility` +
      `&past_hours=3&forecast_hours=0` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/New_York`;

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;

    const data = await response.json();
    if (!data.current) return null;

    const c = data.current;

    // Sum precipitation from last 3 hours for better context
    let recentPrecip = 0;
    let recentRain = 0;
    let recentSnow = 0;
    let minVisibility = 10;

    if (data.hourly) {
      for (let i = 0; i < data.hourly.time.length; i++) {
        recentPrecip += data.hourly.precipitation?.[i] || 0;
        recentRain += data.hourly.rain?.[i] || 0;
        recentSnow += data.hourly.snowfall?.[i] || 0;
        const visMiles = (data.hourly.visibility?.[i] || 16000) / 1609.34; // Convert m to miles
        if (visMiles < minVisibility) minVisibility = visMiles;
      }
    }

    // Get visibility from current or recent hourly
    let visibility = c.visibility ? c.visibility / 1609.34 : minVisibility; // Convert m to miles

    const temp = Math.round(c.temperature_2m || 0);
    const rh = Math.round(c.relative_humidity_2m || 0);

    return {
      temperature: temp,
      apparentTemperature: Math.round(c.apparent_temperature || c.temperature_2m || 0),
      relativeHumidity: rh,
      precipitation: recentPrecip > 0 ? recentPrecip : (c.precipitation || 0),
      rain: recentRain > 0 ? recentRain : (c.rain || 0),
      snowfall: recentSnow > 0 ? recentSnow : (c.snowfall || 0),
      weatherCode: c.weather_code || 0,
      cloudCover: Math.round(c.cloud_cover || 0),
      pressure: c.pressure_msl ? Math.round(c.pressure_msl * 0.02953 * 100) / 100 : 0, // Convert hPa to inHg
      windSpeed: Math.round(c.wind_speed_10m || 0),
      windDirection: Math.round(c.wind_direction_10m || 0),
      windGusts: Math.round(c.wind_gusts_10m || 0),
      visibility: Math.round(visibility * 10) / 10,
      dewPoint: calculateDewPoint(temp, rh),
    };
  } catch (error) {
    console.error(`Error fetching current conditions for ${city.name}:`, error);
    return null;
  }
}

// Calculate hours since last 06z run
function getHoursSince06z(): number {
  const now = new Date();
  const utcHour = now.getUTCHours();
  // 06z = 6 AM UTC
  // If current hour >= 6, hours since 06z = current hour - 6
  // If current hour < 6, hours since 06z = current hour + 18 (previous day's 06z)
  return utcHour >= 6 ? utcHour - 6 : utcHour + 18;
}

// Fetch Day 1 snowfall from HRRR 06z run via Previous Runs API for accurate accumulation
async function fetchHRRR06zSnowfall(city: { name: string; state: string; lat: number; lon: number }): Promise<{ totalSnow: number; snowDepth: number } | null> {
  try {
    // Calculate how many model runs back to get to 06z
    // Open-Meteo Previous Runs API allows past_runs to access older model runs
    // We want the 06z run which gives full day accumulation view
    const hoursSince06z = getHoursSince06z();

    // Use Previous Runs API to get data from an earlier model run
    // Request 24 hours of data starting from 06z
    const url = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}` +
      `&hourly=snowfall,snow_depth` +
      `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=UTC` +
      `&past_runs=${Math.max(1, Math.floor(hoursSince06z / 6))}`; // Get previous runs (runs update ~every 6 hours)

    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      console.log(`HRRR 06z fetch failed for ${city.name}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.hourly) return null;

    const hourly = data.hourly;

    // Get today's date in UTC
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Sum snowfall for today only (from 06z to end of day)
    // Note: precipitation_unit=inch in the URL means snowfall is already in inches
    let totalSnow = 0;
    let maxSnowDepth = 0;

    for (let i = 0; i < hourly.time.length; i++) {
      const timeStr = hourly.time[i];
      if (timeStr.startsWith(todayStr)) {
        // Snowfall is already in inches (precipitation_unit=inch in URL)
        const snowInches = hourly.snowfall[i] || 0;
        totalSnow += snowInches;

        // Snow depth is in feet (from API units), convert to inches
        const depthFt = hourly.snow_depth[i] || 0;
        const depthInches = depthFt * 12;
        if (depthInches > maxSnowDepth) maxSnowDepth = depthInches;
      }
    }

    return {
      totalSnow: Math.round(totalSnow * 10) / 10, // Round to 0.1"
      snowDepth: Math.round(maxSnowDepth * 10) / 10,
    };
  } catch (error) {
    console.error(`Error fetching HRRR 06z snowfall for ${city.name}:`, error);
    return null;
  }
}

// Fetch Day 1 data using HRRR model (via GFS endpoint which auto-blends HRRR for US)
async function fetchHRRRDay1(city: { name: string; state: string; lat: number; lon: number }): Promise<CityForecast["day1"] | null> {
  try {
    // Use GFS endpoint which automatically uses HRRR for US locations
    // Request hourly data for the next 24 hours with all parameters
    const url = `https://api.open-meteo.com/v1/gfs?latitude=${city.lat}&longitude=${city.lon}` +
      `&hourly=temperature_2m,apparent_temperature,precipitation,rain,snowfall,snow_depth,weather_code,cloud_cover,visibility,wind_speed_10m,wind_gusts_10m,cape` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/New_York` +
      `&forecast_hours=24`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      console.log(`HRRR fetch failed for ${city.name}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.hourly) return null;

    const hourly = data.hourly as HourlyData;
    const temps = hourly.temperature_2m.filter(t => t !== null);
    const feelsLike = hourly.apparent_temperature.filter(t => t !== null);
    const precip = hourly.precipitation.filter(p => p !== null);
    const rain = hourly.rain.filter(r => r !== null);
    const snow = hourly.snowfall.filter(s => s !== null);
    const snowDepth = hourly.snow_depth?.filter(s => s !== null) || [];
    const windSpeed = hourly.wind_speed_10m.filter(w => w !== null);
    const windGusts = hourly.wind_gusts_10m.filter(w => w !== null);
    const cape = hourly.cape?.filter(c => c !== null) || [];
    const visibility = hourly.visibility?.filter(v => v !== null) || [];
    const cloudCover = hourly.cloud_cover?.filter(c => c !== null) || [];
    const weatherCodes = hourly.weather_code.filter(w => w !== null);

    // Find dominant weather code (most severe)
    const severityCodes = [99, 96, 95, 86, 85, 82, 81, 80, 75, 73, 71, 77, 67, 66, 65, 63, 61, 57, 56, 55, 53, 51, 48, 45, 3, 2, 1, 0];
    let dominantCode = 0;
    for (const code of severityCodes) {
      if (weatherCodes.includes(code)) {
        dominantCode = code;
        break;
      }
    }

    // Generate hourly highlights for significant weather
    const highlights: string[] = [];
    const totalSnow = snow.reduce((a, b) => a + b, 0);
    const totalRain = rain.reduce((a, b) => a + b, 0);
    const maxGusts = Math.max(...windGusts, 0);
    const maxCapeVal = Math.max(...cape, 0);

    if (totalSnow >= 1) highlights.push(`${totalSnow.toFixed(1)}" snow accumulation`);
    if (totalRain >= 0.5) highlights.push(`${totalRain.toFixed(2)}" rainfall`);
    if (maxGusts >= 40) highlights.push(`Wind gusts to ${Math.round(maxGusts)} mph`);
    if (maxCapeVal >= 1000) highlights.push(`CAPE ${Math.round(maxCapeVal)} J/kg (storm potential)`);
    if (visibility.length > 0 && Math.min(...visibility) < 1) highlights.push(`Low visibility (<1 mile)`);

    return {
      tempHigh: Math.round(Math.max(...temps)),
      tempLow: Math.round(Math.min(...temps)),
      feelsLikeHigh: Math.round(Math.max(...feelsLike)),
      feelsLikeLow: Math.round(Math.min(...feelsLike)),
      totalPrecip: precip.reduce((a, b) => a + b, 0),
      totalRain: totalRain,
      totalSnow: totalSnow,
      maxSnowDepth: snowDepth.length > 0 ? Math.max(...snowDepth) : 0,
      maxWindSpeed: Math.round(Math.max(...windSpeed, 0)),
      maxWindGusts: Math.round(maxGusts),
      maxCape: Math.round(maxCapeVal),
      minVisibility: visibility.length > 0 ? Math.min(...visibility) / 5280 : 10, // Convert meters to miles
      avgCloudCover: cloudCover.length > 0 ? Math.round(cloudCover.reduce((a, b) => a + b, 0) / cloudCover.length) : 0,
      dominantWeatherCode: dominantCode,
      hourlyHighlights: highlights,
    };
  } catch (error) {
    console.error(`Error fetching HRRR for ${city.name}:`, error);
    return null;
  }
}

// Fetch Days 2-7 data using ECMWF model
async function fetchECMWFExtended(city: { name: string; state: string; lat: number; lon: number }): Promise<CityForecast["extendedDays"] | null> {
  try {
    const url = `https://api.open-meteo.com/v1/ecmwf?latitude=${city.lat}&longitude=${city.lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,rain_sum,snowfall_sum,wind_speed_10m_max,wind_gusts_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/New_York` +
      `&forecast_days=8`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      console.log(`ECMWF fetch failed for ${city.name}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.daily) return null;

    const daily = data.daily as DailyData;
    const extendedDays: CityForecast["extendedDays"] = [];

    // Skip day 0 (today), get days 1-6 (tomorrow through day 7)
    for (let i = 1; i < Math.min(daily.time.length, 7); i++) {
      extendedDays.push({
        date: daily.time[i],
        dayNumber: i + 1,
        tempHigh: Math.round(daily.temperature_2m_max[i] || 0),
        tempLow: Math.round(daily.temperature_2m_min[i] || 0),
        feelsLikeHigh: Math.round(daily.apparent_temperature_max?.[i] || daily.temperature_2m_max[i] || 0),
        feelsLikeLow: Math.round(daily.apparent_temperature_min?.[i] || daily.temperature_2m_min[i] || 0),
        totalPrecip: daily.precipitation_sum[i] || 0,
        totalRain: daily.rain_sum?.[i] || 0,
        totalSnow: daily.snowfall_sum?.[i] || 0,
        precipProbability: daily.precipitation_probability_max?.[i] || 0,
        maxWindSpeed: Math.round(daily.wind_speed_10m_max[i] || 0),
        maxWindGusts: Math.round(daily.wind_gusts_10m_max?.[i] || 0),
        weatherCode: daily.weather_code[i] || 0,
      });
    }

    return extendedDays;
  } catch (error) {
    console.error(`Error fetching ECMWF for ${city.name}:`, error);
    return null;
  }
}

// Fetch complete forecast for a city
async function fetchCityForecast(city: { name: string; state: string; lat: number; lon: number }, region: string): Promise<CityForecast | null> {
  const [current, day1, extendedDays, snowfall06z] = await Promise.all([
    fetchCurrentConditions(city),
    fetchHRRRDay1(city),
    fetchECMWFExtended(city),
    fetchHRRR06zSnowfall(city), // Get accurate snowfall from 06z run
  ]);

  if (!current && !day1 && !extendedDays) return null;

  // Merge 06z snowfall data with day1 data (06z snowfall is more accurate for accumulation)
  let finalDay1 = day1 || {
    tempHigh: 0, tempLow: 0, feelsLikeHigh: 0, feelsLikeLow: 0,
    totalPrecip: 0, totalRain: 0, totalSnow: 0, maxSnowDepth: 0,
    maxWindSpeed: 0, maxWindGusts: 0, maxCape: 0, minVisibility: 10,
    avgCloudCover: 0, dominantWeatherCode: 0, hourlyHighlights: [],
  };

  // Use 06z snowfall if available and greater than current estimate
  // (06z run provides full-day accumulation projection)
  if (snowfall06z) {
    if (snowfall06z.totalSnow > finalDay1.totalSnow) {
      finalDay1 = {
        ...finalDay1,
        totalSnow: snowfall06z.totalSnow,
        maxSnowDepth: Math.max(finalDay1.maxSnowDepth, snowfall06z.snowDepth),
      };
    }
  }

  return {
    city: city.name,
    state: city.state,
    region,
    lat: city.lat,
    lon: city.lon,
    current,
    day1: finalDay1,
    extendedDays: extendedDays || [],
  };
}

// Build regional summary from city forecasts
function buildRegionSummary(regionId: string, forecasts: CityForecast[]): RegionSummary {
  const info = REGION_INFO[regionId];

  // Current conditions snapshot
  const currentForecasts = forecasts.filter(f => f.current !== null);
  const currentTemps = currentForecasts.map(f => f.current!.temperature);
  const currentFeels = currentForecasts.map(f => f.current!.apparentTemperature);
  const currentHumidity = currentForecasts.map(f => f.current!.relativeHumidity);
  const currentPressure = currentForecasts.map(f => f.current!.pressure).filter(p => p > 0);
  const currentWindSpeed = currentForecasts.map(f => f.current!.windSpeed);
  const currentWindGusts = currentForecasts.map(f => f.current!.windGusts);

  // Find notable cities
  const coldestCity = currentForecasts.reduce((min, f) =>
    f.current!.temperature < min.temp ? { name: `${f.city}, ${f.state}`, temp: f.current!.temperature } : min,
    { name: "", temp: 999 }
  );
  const warmestCity = currentForecasts.reduce((max, f) =>
    f.current!.temperature > max.temp ? { name: `${f.city}, ${f.state}`, temp: f.current!.temperature } : max,
    { name: "", temp: -999 }
  );
  const windiestCity = currentForecasts.reduce((max, f) =>
    f.current!.windGusts > max.gusts ? { name: `${f.city}, ${f.state}`, gusts: f.current!.windGusts } : max,
    { name: "", gusts: 0 }
  );

  // Active precipitation
  const activePrecip: { city: string; type: string; rate: number }[] = [];
  for (const f of currentForecasts) {
    if (f.current!.snowfall > 0) {
      activePrecip.push({ city: `${f.city}, ${f.state}`, type: "snow", rate: f.current!.snowfall });
    } else if (f.current!.rain > 0) {
      activePrecip.push({ city: `${f.city}, ${f.state}`, type: "rain", rate: f.current!.rain });
    }
  }

  // Current dominant conditions
  const currentCodes = currentForecasts.map(f => f.current!.weatherCode);
  const currentCondCounts: Record<string, number> = {};
  for (const code of currentCodes) {
    const desc = getWeatherDescription(code);
    currentCondCounts[desc] = (currentCondCounts[desc] || 0) + 1;
  }
  const currentDominant = Object.entries(currentCondCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cond]) => cond);

  // Get dew points and visibility
  const currentDewPoints = currentForecasts.map(f => f.current!.dewPoint);
  const currentVisibility = currentForecasts.map(f => f.current!.visibility);

  const currentSnapshot: RegionCurrentSnapshot = {
    tempRange: {
      min: currentTemps.length > 0 ? Math.min(...currentTemps) : 0,
      max: currentTemps.length > 0 ? Math.max(...currentTemps) : 0,
      avg: currentTemps.length > 0 ? Math.round(currentTemps.reduce((a, b) => a + b, 0) / currentTemps.length) : 0,
    },
    feelsLikeRange: {
      min: currentFeels.length > 0 ? Math.min(...currentFeels) : 0,
      max: currentFeels.length > 0 ? Math.max(...currentFeels) : 0,
    },
    dewPointRange: {
      min: currentDewPoints.length > 0 ? Math.min(...currentDewPoints) : 0,
      max: currentDewPoints.length > 0 ? Math.max(...currentDewPoints) : 0,
    },
    humidityRange: {
      min: currentHumidity.length > 0 ? Math.min(...currentHumidity) : 0,
      max: currentHumidity.length > 0 ? Math.max(...currentHumidity) : 0,
    },
    pressureRange: {
      min: currentPressure.length > 0 ? Math.min(...currentPressure) : 0,
      max: currentPressure.length > 0 ? Math.max(...currentPressure) : 0,
    },
    windSpeedMax: currentWindSpeed.length > 0 ? Math.max(...currentWindSpeed) : 0,
    windGustsMax: currentWindGusts.length > 0 ? Math.max(...currentWindGusts) : 0,
    visibilityMin: currentVisibility.length > 0 ? Math.min(...currentVisibility) : 10,
    dominantConditions: currentDominant,
    activePrecip,
    coldestCity,
    warmestCity,
    windiestCity,
  };

  // Day 1 aggregation
  const day1Temps = forecasts.map(f => f.day1.tempHigh).filter(t => t > -100);
  const day1TempLows = forecasts.map(f => f.day1.tempLow).filter(t => t > -100);
  const day1FeelsHigh = forecasts.map(f => f.day1.feelsLikeHigh).filter(t => t > -100);
  const day1FeelsLow = forecasts.map(f => f.day1.feelsLikeLow).filter(t => t > -100);
  const day1Precip = forecasts.map(f => f.day1.totalPrecip);
  const day1Snow = forecasts.map(f => f.day1.totalSnow);
  const day1SnowDepth = forecasts.map(f => f.day1.maxSnowDepth);
  const day1Gusts = forecasts.map(f => f.day1.maxWindGusts);
  const day1Cape = forecasts.map(f => f.day1.maxCape);
  const day1Visibility = forecasts.map(f => f.day1.minVisibility);

  const citiesWithSnow = forecasts.filter(f => f.day1.totalSnow >= 0.5).map(f => `${f.city} (${f.day1.totalSnow.toFixed(1)}")`);
  const citiesWithRain = forecasts.filter(f => f.day1.totalRain >= 0.25).map(f => `${f.city} (${f.day1.totalRain.toFixed(2)}")`);
  const citiesWithHighWind = forecasts.filter(f => f.day1.maxWindGusts >= 35).map(f => `${f.city} (${f.day1.maxWindGusts} mph gusts)`);

  // Find coldest and warmest cities for Day 1 (using tempLow for coldest, tempHigh for warmest)
  const day1ColdestCity = forecasts.reduce((min, f) =>
    f.day1.tempLow < min.temp ? { name: `${f.city}, ${f.state}`, temp: f.day1.tempLow } : min,
    { name: "", temp: 999 }
  );
  const day1WarmestCity = forecasts.reduce((max, f) =>
    f.day1.tempHigh > max.temp ? { name: `${f.city}, ${f.state}`, temp: f.day1.tempHigh } : max,
    { name: "", temp: -999 }
  );

  // Get dominant conditions
  const weatherCodes = forecasts.map(f => f.day1.dominantWeatherCode);
  const conditionCounts: Record<string, number> = {};
  for (const code of weatherCodes) {
    const desc = getWeatherDescription(code);
    conditionCounts[desc] = (conditionCounts[desc] || 0) + 1;
  }
  const dominantConditions = Object.entries(conditionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cond]) => cond);

  // Extended days aggregation
  const extendedDays: RegionSummary["extendedDays"] = [];
  for (let dayIdx = 0; dayIdx < 6; dayIdx++) {
    const dayForecasts = forecasts.map(f => f.extendedDays[dayIdx]).filter(d => d);
    if (dayForecasts.length === 0) continue;

    const temps = dayForecasts.map(d => d.tempHigh);
    const tempLows = dayForecasts.map(d => d.tempLow);
    const precip = dayForecasts.map(d => d.totalPrecip);
    const snow = dayForecasts.map(d => d.totalSnow);
    const gusts = dayForecasts.map(d => d.maxWindGusts);
    const codes = dayForecasts.map(d => d.weatherCode);

    const dayConds: Record<string, number> = {};
    for (const code of codes) {
      const desc = getWeatherDescription(code);
      dayConds[desc] = (dayConds[desc] || 0) + 1;
    }
    const dayDominant = Object.entries(dayConds)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([cond]) => cond);

    extendedDays.push({
      dayNumber: dayIdx + 2,
      date: dayForecasts[0].date,
      tempRange: { min: Math.min(...tempLows), max: Math.max(...temps) },
      totalPrecipRange: { min: Math.min(...precip), max: Math.max(...precip) },
      totalSnowRange: { min: Math.min(...snow), max: Math.max(...snow) },
      maxWindGusts: Math.max(...gusts),
      dominantConditions: dayDominant,
    });
  }

  return {
    regionId,
    regionName: info.name,
    states: info.states,
    cityCount: forecasts.length,
    currentSnapshot,
    day1: {
      tempRange: {
        min: Math.min(...day1TempLows),
        max: Math.max(...day1Temps),
        avg: Math.round(day1Temps.reduce((a, b) => a + b, 0) / day1Temps.length),
      },
      feelsLikeRange: {
        min: Math.min(...day1FeelsLow),
        max: Math.max(...day1FeelsHigh),
      },
      totalPrecipRange: { min: Math.min(...day1Precip), max: Math.max(...day1Precip) },
      totalSnowRange: { min: Math.min(...day1Snow), max: Math.max(...day1Snow) },
      maxSnowDepth: Math.max(...day1SnowDepth),
      windGustsMax: Math.max(...day1Gusts),
      maxCape: Math.max(...day1Cape),
      minVisibility: Math.min(...day1Visibility),
      dominantConditions,
      citiesWithSnow,
      citiesWithRain,
      citiesWithHighWind,
      coldestCity: day1ColdestCity,
      warmestCity: day1WarmestCity,
    },
    extendedDays,
    cityForecasts: forecasts,
  };
}

export async function getOpenMeteoContext(): Promise<string> {
  const startTime = Date.now();
  console.log("Fetching weather data from Open-Meteo (HRRR Day 1 + ECMWF Days 2-7)...");

  const regionSummaries: RegionSummary[] = [];

  // Fetch all cities in parallel (batched by region)
  for (const [regionId, cities] of Object.entries(REGION_CITIES)) {
    const cityForecasts = await Promise.all(
      cities.map(city => fetchCityForecast(city, regionId))
    );
    const validForecasts = cityForecasts.filter((f): f is CityForecast => f !== null);

    if (validForecasts.length > 0) {
      regionSummaries.push(buildRegionSummary(regionId, validForecasts));
    }
  }

  console.log(`Open-Meteo data fetched in ${(Date.now() - startTime) / 1000}s`);

  // Build context string for OpenAI
  const today = new Date();
  const dayNames: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    dayNames.push(d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }));
  }

  const currentTime = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  let context = `
================================================================================
REAL-TIME WEATHER DATA - ${new Date().toISOString()}
================================================================================

MODEL SOURCES:
- CURRENT CONDITIONS: NOAA GFS/HRRR blend (real-time surface analysis)
- Day 1 (Today): NOAA HRRR (High Resolution Rapid Refresh) - 3km resolution, hourly updates
- Day 1 SNOWFALL: HRRR 06z run (Kuchera-style full-day accumulation projection)
- Days 2-7: ECMWF (European Model) - Best global medium-range model

CURRENT TIME: ${currentTime} ET
TODAY is ${dayNames[0]}
Day 1 = ${dayNames[0]} | Day 2 = ${dayNames[1]} | Day 3 = ${dayNames[2]}
Day 4 = ${dayNames[3]} | Day 5 = ${dayNames[4]} | Day 6 = ${dayNames[5]} | Day 7 = ${dayNames[6]}

================================================================================
CURRENT CONDITIONS SNAPSHOT (Surface Analysis)
================================================================================
`;

  // Add current conditions for each region
  for (const region of regionSummaries) {
    const snap = region.currentSnapshot;
    context += `
--- ${region.regionName.toUpperCase()} - RIGHT NOW (GFS/HRRR Model Analysis) ---
Temperature Range: ${snap.tempRange.min}°F to ${snap.tempRange.max}°F (avg ${snap.tempRange.avg}°F)
Feels Like Range: ${snap.feelsLikeRange.min}°F to ${snap.feelsLikeRange.max}°F
Dew Point Range: ${snap.dewPointRange.min}°F to ${snap.dewPointRange.max}°F
Humidity Range: ${snap.humidityRange.min}% to ${snap.humidityRange.max}%
`;
    if (snap.pressureRange.min > 0) {
      context += `Pressure Range: ${snap.pressureRange.min.toFixed(2)}" to ${snap.pressureRange.max.toFixed(2)}" Hg\n`;
    }
    if (snap.visibilityMin < 10) {
      context += `Minimum Visibility: ${snap.visibilityMin.toFixed(1)} miles\n`;
    }
    context += `Conditions: ${snap.dominantConditions.join(", ")}\n`;

    if (snap.coldestCity.name && snap.warmestCity.name) {
      context += `Coldest: ${snap.coldestCity.name} (${snap.coldestCity.temp}°F) | Warmest: ${snap.warmestCity.name} (${snap.warmestCity.temp}°F)\n`;
    }

    if (snap.windGustsMax >= 15) {
      context += `Max Wind Gusts: ${snap.windGustsMax} mph`;
      if (snap.windiestCity.name) {
        context += ` at ${snap.windiestCity.name}`;
      }
      context += "\n";
    }

    if (snap.activePrecip.length > 0) {
      context += `ACTIVE PRECIPITATION (last 3 hours):\n`;
      for (const p of snap.activePrecip) {
        context += `  - ${p.city}: ${p.type} (${p.rate.toFixed(2)}")\n`;
      }
    }
  }

  context += `
================================================================================
REGIONAL WEATHER FORECASTS
================================================================================
`;

  for (const region of regionSummaries) {
    context += `
=== ${region.regionName.toUpperCase()} (${region.states.join(", ")}) ===
Data from ${region.cityCount} cities across the region

--- DAY 1 (TODAY - HRRR MODEL) ---
Temperature Range: ${region.day1.tempRange.min}°F to ${region.day1.tempRange.max}°F (avg ${region.day1.tempRange.avg}°F)
Coldest: ${region.day1.coldestCity.name} (${region.day1.coldestCity.temp}°F) | Warmest: ${region.day1.warmestCity.name} (${region.day1.warmestCity.temp}°F)
Feels Like Range: ${region.day1.feelsLikeRange.min}°F to ${region.day1.feelsLikeRange.max}°F
Dominant Conditions: ${region.day1.dominantConditions.join(", ")}
`;

    if (region.day1.totalSnowRange.max > 0) {
      context += `Snow Accumulation Range: ${region.day1.totalSnowRange.min.toFixed(1)}" to ${region.day1.totalSnowRange.max.toFixed(1)}"\n`;
      if (region.day1.citiesWithSnow.length > 0) {
        context += `Cities with Snow: ${region.day1.citiesWithSnow.join(", ")}\n`;
      }
    }

    if (region.day1.totalPrecipRange.max > 0.1) {
      context += `Precipitation Range: ${region.day1.totalPrecipRange.min.toFixed(2)}" to ${region.day1.totalPrecipRange.max.toFixed(2)}"\n`;
      if (region.day1.citiesWithRain.length > 0) {
        context += `Cities with Rain: ${region.day1.citiesWithRain.join(", ")}\n`;
      }
    }

    if (region.day1.windGustsMax >= 25) {
      context += `Max Wind Gusts: ${region.day1.windGustsMax} mph\n`;
      if (region.day1.citiesWithHighWind.length > 0) {
        context += `Cities with High Winds: ${region.day1.citiesWithHighWind.join(", ")}\n`;
      }
    }

    if (region.day1.maxCape >= 500) {
      context += `Max CAPE: ${region.day1.maxCape} J/kg (thunderstorm potential)\n`;
    }

    if (region.day1.minVisibility < 3) {
      context += `Minimum Visibility: ${region.day1.minVisibility.toFixed(1)} miles\n`;
    }

    // Extended forecast
    context += `\n--- DAYS 2-7 (ECMWF MODEL) ---\n`;
    for (const day of region.extendedDays) {
      const dateLabel = dayNames[day.dayNumber - 1] || `Day ${day.dayNumber}`;
      context += `Day ${day.dayNumber} (${dateLabel}): `;
      context += `Temps ${day.tempRange.min}°F to ${day.tempRange.max}°F. `;
      context += `${day.dominantConditions.join(", ")}. `;

      if (day.totalSnowRange.max >= 0.5) {
        context += `Snow ${day.totalSnowRange.min.toFixed(1)}"-${day.totalSnowRange.max.toFixed(1)}". `;
      }
      if (day.totalPrecipRange.max >= 0.25) {
        context += `Precip ${day.totalPrecipRange.min.toFixed(2)}"-${day.totalPrecipRange.max.toFixed(2)}". `;
      }
      if (day.maxWindGusts >= 30) {
        context += `Gusts to ${day.maxWindGusts} mph. `;
      }
      context += "\n";
    }

    // Current conditions by city
    context += `\n--- CITY CURRENT CONDITIONS (Model Analysis) ---\n`;
    for (const city of region.cityForecasts) {
      if (city.current) {
        context += `${city.city}, ${city.state}: ${city.current.temperature}°F`;
        if (Math.abs(city.current.apparentTemperature - city.current.temperature) >= 5) {
          context += ` (feels ${city.current.apparentTemperature}°F)`;
        }
        context += `, Dew ${city.current.dewPoint}°F`;
        context += `, ${getWeatherDescription(city.current.weatherCode)}`;
        context += `, Wind ${city.current.windSpeed} mph`;
        if (city.current.windGusts > city.current.windSpeed + 5) {
          context += ` (gusts ${city.current.windGusts})`;
        }
        if (city.current.visibility < 5) {
          context += `, Vis ${city.current.visibility.toFixed(1)} mi`;
        }
        if (city.current.precipitation > 0 || city.current.snowfall > 0) {
          context += `, Precip: ${city.current.snowfall > 0 ? `Snow ${city.current.snowfall.toFixed(2)}"` : `Rain ${city.current.rain.toFixed(2)}"`}`;
        }
        context += "\n";
      }
    }

    // Individual city details for Day 1 forecast
    context += `\n--- CITY DAY 1 FORECAST ---\n`;
    for (const city of region.cityForecasts) {
      context += `${city.city}, ${city.state}: High ${city.day1.tempHigh}°F, Low ${city.day1.tempLow}°F`;
      if (city.day1.totalSnow > 0) context += `, Snow ${city.day1.totalSnow.toFixed(1)}"`;
      if (city.day1.totalRain > 0.1) context += `, Rain ${city.day1.totalRain.toFixed(2)}"`;
      if (city.day1.maxWindGusts >= 30) context += `, Gusts ${city.day1.maxWindGusts} mph`;
      context += `. ${getWeatherDescription(city.day1.dominantWeatherCode)}.\n`;
    }

    context += "\n";
  }

  context += `
================================================================================
FORECAST GENERATION INSTRUCTIONS
================================================================================

DATA SOURCES EXPLAINED:
- CURRENT CONDITIONS: Real-time surface observations/analysis - use for "right now" weather
- HRRR DAY 1: High-resolution hourly forecast for today - most accurate for 0-24 hours
- ECMWF DAYS 2-7: European model extended forecast - best for medium-range planning

CRITICAL: Use REGIONAL RANGES, not individual city values, when writing forecasts.
- Say "temperatures currently ranging from 25°F in Buffalo to 42°F in New York City"
- Say "highs today will range from 35°F to 52°F across the region"
- Say "1-4 inches of snow expected, with heaviest amounts near Buffalo and Syracuse"
- Say "wind gusts up to 45 mph possible, especially in exposed areas"

CURRENT CONDITIONS USAGE:
- Use the "RIGHT NOW" snapshot to describe current weather situation
- Note active precipitation (snow/rain currently falling)
- Highlight temperature contrasts (coldest vs warmest cities)
- Mention current wind conditions if significant

PRECIPITATION ACCURACY:
- Use ACTUAL snow/rain totals from the HRRR data
- For lake-effect regions (Buffalo, Syracuse, Cleveland, Grand Rapids), note enhanced snowfall
- Include specific city comparisons when there's significant variation
- Note any active precipitation from current conditions

RISK ASSESSMENT:
- Snow > 4": Elevated risk
- Snow > 8": High risk
- Wind gusts > 50 mph: High wind risk
- CAPE > 1500 J/kg: Severe weather potential
- Visibility < 1 mile: Travel impacts
- Active heavy precipitation: Elevated travel risk

REGIONAL PERSPECTIVE:
- Temperature ranges should reflect the ENTIRE region, not one city
- Note the coldest and warmest areas within each region
- Highlight where the most significant weather is occurring
- Compare current conditions to forecast to show expected changes
`;

  return context;
}
