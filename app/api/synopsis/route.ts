import { NextResponse } from "next/server";
import { generateUSWeatherSynopsis } from "@/lib/us-weather-synopsis";
import { CITIES } from "@/lib/cities";
import { fetchOpenMeteoForecast } from "@/lib/openMeteo";
import { RegionId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function isoUtcNow() {
  return new Date().toISOString();
}

function dayName(offsetDays: number) {
  // Use Eastern Time for day labels
  const d = new Date();
  const estString = d.toLocaleString("en-US", { timeZone: "America/New_York" });
  const estDate = new Date(estString);
  estDate.setDate(estDate.getDate() + offsetDays);
  return estDate.toLocaleDateString("en-US", { weekday: "long" });
}

// Map synopsis region IDs to app region IDs
const SYNOPSIS_REGION_MAP: Record<string, { appRegions: RegionId[]; states: string }> = {
  west_coast: {
    appRegions: ['northwest', 'southwest'],
    states: 'California, Oregon, Washington, Idaho, Nevada, Arizona, Utah',
  },
  rockies: {
    appRegions: ['northern_plains', 'southwest'],
    states: 'New Mexico, Colorado, Wyoming, Montana',
  },
  great_plains: {
    appRegions: ['northern_plains', 'southern_plains'],
    states: 'North Dakota, South Dakota, Nebraska, Kansas, Oklahoma, Texas, Arkansas, Louisiana',
  },
  midwest: {
    appRegions: ['midwest'],
    states: 'Minnesota, Iowa, Missouri, Illinois, Indiana, Ohio, Michigan, Wisconsin',
  },
  northeast: {
    appRegions: ['northeast'],
    states: 'Pennsylvania, New York, New Jersey, Rhode Island, Connecticut, Massachusetts, New Hampshire, Vermont, Maine',
  },
  southeast: {
    appRegions: ['southeast'],
    states: 'Kentucky, Tennessee, Mississippi, Alabama, Georgia, Florida, South Carolina, North Carolina, Virginia, West Virginia, Washington DC, Maryland, Delaware',
  },
};

// Get sample cities for each synopsis region
function getCitiesForSynopsisRegion(synopsisRegionId: string): typeof CITIES {
  const mapping = SYNOPSIS_REGION_MAP[synopsisRegionId];
  if (!mapping) return [];

  const cities = CITIES.filter(city => mapping.appRegions.includes(city.regionId));
  // Sample up to 10 cities per region for performance
  return cities.slice(0, 10);
}

interface CityWeatherData {
  name: string;
  state: string;
  days: Array<{
    tmax: number;
    tmin: number;
    rain: number;
    snow: number;
    windGust: number;
    weatherCode: number;
  }>;
}

async function fetchRegionWeatherData(synopsisRegionId: string): Promise<CityWeatherData[]> {
  const cities = getCitiesForSynopsisRegion(synopsisRegionId);
  const results: CityWeatherData[] = [];

  // Fetch weather for each city (in parallel for speed)
  const promises = cities.map(async (city) => {
    try {
      const data = await fetchOpenMeteoForecast(city.lat, city.lon, {
        hourly: false,
        daily: true,
        days: 7,
      });

      if (!data.daily) return null;

      const days = data.daily.time.slice(0, 7).map((_, i) => ({
        tmax: Math.round(data.daily!.temperature_2m_max[i] || 50),
        tmin: Math.round(data.daily!.temperature_2m_min[i] || 30),
        rain: Math.round((data.daily!.rain_sum?.[i] || data.daily!.precipitation_sum?.[i] || 0) * 100) / 100,
        snow: Math.round((data.daily!.snowfall_sum?.[i] || 0) * 10) / 10,
        windGust: Math.round(data.daily!.wind_gusts_10m_max?.[i] || 0),
        weatherCode: data.daily!.weather_code?.[i] || 0,
      }));

      return {
        name: city.name,
        state: city.state,
        days,
      };
    } catch {
      return null;
    }
  });

  const resolved = await Promise.all(promises);
  for (const result of resolved) {
    if (result) results.push(result);
  }

  return results;
}

function buildRegionContext(synopsisRegionId: string, cityData: CityWeatherData[]): string {
  const mapping = SYNOPSIS_REGION_MAP[synopsisRegionId];
  if (!mapping || cityData.length === 0) {
    return `${synopsisRegionId.toUpperCase().replace('_', ' ')} (${mapping?.states || 'Unknown'}): Limited data available.`;
  }

  const regionName = synopsisRegionId.toUpperCase().replace('_', ' ');
  let context = `${regionName} (${mapping.states}):\n`;

  // Build context for each day (1-3 for detailed, 4-7 for summary)
  for (let day = 0; day < 3; day++) {
    const dayLabel = `Day ${day + 1}`;

    // Aggregate data for this day
    const tmaxs = cityData.map(c => c.days[day]?.tmax || 50);
    const tmins = cityData.map(c => c.days[day]?.tmin || 30);
    const rains = cityData.map(c => c.days[day]?.rain || 0);
    const snows = cityData.map(c => c.days[day]?.snow || 0);
    const gusts = cityData.map(c => c.days[day]?.windGust || 0);

    const avgHigh = Math.round(tmaxs.reduce((a, b) => a + b, 0) / tmaxs.length);
    const avgLow = Math.round(tmins.reduce((a, b) => a + b, 0) / tmins.length);
    const maxHigh = Math.max(...tmaxs);
    const minLow = Math.min(...tmins);
    const maxRain = Math.max(...rains);
    const maxSnow = Math.max(...snows);
    const maxGust = Math.max(...gusts);
    const avgGust = Math.round(gusts.reduce((a, b) => a + b, 0) / gusts.length);

    // Build city-specific details
    const cityDetails: string[] = [];
    for (const city of cityData.slice(0, 5)) {
      const d = city.days[day];
      if (!d) continue;
      let detail = `${city.name} highs ${d.tmax}°F, lows ${d.tmin}°F`;
      if (d.snow > 0.5) detail += `, ${d.snow}" snow`;
      else if (d.rain > 0.25) detail += `, ${d.rain}" rain`;
      if (d.windGust >= 30) detail += `, gusts to ${d.windGust} mph`;
      cityDetails.push(detail);
    }

    context += `${dayLabel}: `;
    context += `Highs ${minLow < avgHigh - 15 ? `ranging from upper ${Math.floor(minLow / 10) * 10}s to ` : ''}${Math.floor(avgHigh / 10) * 10}s`;
    if (maxHigh - avgHigh > 10) context += ` (up to ${maxHigh}°F in some areas)`;
    context += `, lows in the ${Math.floor(avgLow / 10) * 10}s. `;

    if (maxSnow >= 1) {
      const snowCities = cityData.filter(c => (c.days[day]?.snow || 0) >= 0.5).map(c => c.name);
      context += `Snow expected${snowCities.length > 0 ? ` for ${snowCities.slice(0, 3).join(', ')}` : ''} with accumulations up to ${maxSnow}". `;
    } else if (maxRain >= 0.25) {
      const rainCities = cityData.filter(c => (c.days[day]?.rain || 0) >= 0.1).map(c => c.name);
      context += `Rain expected${rainCities.length > 0 ? ` for ${rainCities.slice(0, 3).join(', ')}` : ''} with totals up to ${maxRain}". `;
    } else {
      context += `Dry conditions expected. `;
    }

    if (maxGust >= 30) {
      context += `Winds gusting to ${maxGust} mph. `;
    } else if (avgGust >= 15) {
      context += `Winds ${avgGust}-${maxGust} mph. `;
    } else {
      context += `Light winds. `;
    }

    // Add specific city details
    if (cityDetails.length > 0) {
      context += cityDetails.slice(0, 3).join('. ') + '. ';
    }
    context += '\n';
  }

  // Days 4-7 summary
  const day4to7Data = cityData.flatMap(c => c.days.slice(3, 7));
  if (day4to7Data.length > 0) {
    const avgHighLong = Math.round(day4to7Data.reduce((a, d) => a + (d?.tmax || 50), 0) / day4to7Data.length);
    const totalSnow = day4to7Data.reduce((a, d) => a + (d?.snow || 0), 0);
    const totalRain = day4to7Data.reduce((a, d) => a + (d?.rain || 0), 0);

    context += `Days 4-7: Temperatures averaging near ${avgHighLong}°F. `;
    if (totalSnow > 1) {
      context += `Additional snow chances with possible accumulations. `;
    } else if (totalRain > 0.5) {
      context += `Some rain chances through the period. `;
    } else {
      context += `Generally dry conditions expected. `;
    }
    context += '\n';
  }

  return context;
}

export async function GET() {
  // Fetch real weather data for all regions
  const synopsisRegions = ['west_coast', 'rockies', 'great_plains', 'midwest', 'northeast', 'southeast'];

  const regionDataPromises = synopsisRegions.map(async (regionId) => {
    const cityData = await fetchRegionWeatherData(regionId);
    return { regionId, cityData };
  });

  const regionResults = await Promise.all(regionDataPromises);

  // Build context from real weather data
  let context = 'Weather Context for US Regions (based on current forecast data):\n\n';

  for (const { regionId, cityData } of regionResults) {
    context += buildRegionContext(regionId, cityData) + '\n';
  }

  context += '\nIMPORTANT: You MUST generate forecast data for ALL 6 regions in this exact order: west_coast, rockies, great_plains, midwest, northeast, southeast. Use the actual weather data provided above - do not invent conditions.\n';

  const data = await generateUSWeatherSynopsis(context);

  // Force correct timestamp and day labels every time
  data.updated_utc = isoUtcNow();
  data.day_labels = {
    day1: dayName(0),
    day2: dayName(1),
    day3: dayName(2),
  };

  // Enforce CTA rule: only if risk >= 4.5 OR changed_since_last true
  for (const r of data.regions || []) {
    const risk = Number(r.risk_scale ?? 0);
    const changed = Boolean(r.changed_since_last);
    if (risk < 4.5 && !changed) r.cta = "";
  }

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "s-maxage=3600, stale-while-revalidate=300",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
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
