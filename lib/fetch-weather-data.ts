// Fetch real weather data from multiple NWS sources

interface CityConfig {
  name: string;
  office: string;
  gridX: number;
  gridY: number;
}

// Representative cities for each region with their NWS grid points
const REGION_CITIES: Record<string, CityConfig[]> = {
  west_coast: [
    { name: "Seattle", office: "SEW", gridX: 124, gridY: 67 },
    { name: "Portland OR", office: "PQR", gridX: 112, gridY: 103 },
    { name: "San Francisco", office: "MTR", gridX: 85, gridY: 105 },
    { name: "Los Angeles", office: "LOX", gridX: 154, gridY: 44 },
    { name: "Phoenix", office: "PSR", gridX: 159, gridY: 59 },
    { name: "Las Vegas", office: "VEF", gridX: 126, gridY: 97 },
    { name: "Boise", office: "BOI", gridX: 139, gridY: 87 },
  ],
  rockies: [
    { name: "Denver", office: "BOU", gridX: 62, gridY: 60 },
    { name: "Salt Lake City", office: "SLC", gridX: 97, gridY: 175 },
    { name: "Billings", office: "BYZ", gridX: 109, gridY: 64 },
    { name: "Albuquerque", office: "ABQ", gridX: 106, gridY: 123 },
    { name: "Cheyenne", office: "CYS", gridX: 88, gridY: 75 },
    { name: "Bozeman", office: "TFX", gridX: 123, gridY: 77 },
  ],
  great_plains: [
    { name: "Dallas", office: "FWD", gridX: 79, gridY: 108 },
    { name: "Houston", office: "HGX", gridX: 65, gridY: 97 },
    { name: "Oklahoma City", office: "OUN", gridX: 53, gridY: 33 },
    { name: "Kansas City", office: "EAX", gridX: 41, gridY: 43 },
    { name: "Omaha", office: "OAX", gridX: 46, gridY: 66 },
    { name: "Fargo", office: "FGF", gridX: 51, gridY: 68 },
    { name: "Sioux Falls", office: "FSD", gridX: 63, gridY: 58 },
    { name: "New Orleans", office: "LIX", gridX: 77, gridY: 77 },
  ],
  midwest: [
    { name: "Chicago", office: "LOT", gridX: 65, gridY: 76 },
    { name: "Detroit", office: "DTX", gridX: 65, gridY: 33 },
    { name: "Minneapolis", office: "MPX", gridX: 107, gridY: 71 },
    { name: "Cleveland", office: "CLE", gridX: 82, gridY: 64 },
    { name: "Indianapolis", office: "IND", gridX: 57, gridY: 68 },
    { name: "Columbus", office: "ILN", gridX: 84, gridY: 84 },
    { name: "Milwaukee", office: "MKX", gridX: 90, gridY: 67 },
  ],
  northeast: [
    { name: "New York City", office: "OKX", gridX: 33, gridY: 37 },
    { name: "Boston", office: "BOX", gridX: 71, gridY: 90 },
    { name: "Philadelphia", office: "PHI", gridX: 49, gridY: 75 },
    { name: "Buffalo", office: "BUF", gridX: 81, gridY: 48 },
    { name: "Burlington VT", office: "BTV", gridX: 53, gridY: 60 },
    { name: "Syracuse", office: "BGM", gridX: 50, gridY: 85 },
    { name: "Albany", office: "ALY", gridX: 60, gridY: 58 },
    { name: "Portland ME", office: "GYX", gridX: 64, gridY: 75 },
  ],
  southeast: [
    { name: "Atlanta", office: "FFC", gridX: 52, gridY: 88 },
    { name: "Miami", office: "MFL", gridX: 109, gridY: 50 },
    { name: "Charlotte", office: "GSP", gridX: 116, gridY: 77 },
    { name: "Nashville", office: "OHX", gridX: 49, gridY: 53 },
    { name: "Washington DC", office: "LWX", gridX: 97, gridY: 71 },
    { name: "Tampa", office: "TBW", gridX: 71, gridY: 98 },
    { name: "Jacksonville", office: "JAX", gridX: 73, gridY: 81 },
    { name: "Richmond", office: "AKQ", gridX: 42, gridY: 71 },
  ],
};

const REGION_NAMES: Record<string, string> = {
  west_coast: "WEST COAST (California, Oregon, Washington, Idaho, Nevada, Arizona, Utah)",
  rockies: "ROCKIES (Colorado, Wyoming, Montana, New Mexico)",
  great_plains: "GREAT PLAINS (Texas, Oklahoma, Kansas, Nebraska, North Dakota, South Dakota, Louisiana, Arkansas)",
  midwest: "MIDWEST (Minnesota, Iowa, Missouri, Illinois, Indiana, Ohio, Michigan, Wisconsin)",
  northeast: "NORTHEAST (New York, Pennsylvania, New Jersey, Massachusetts, Connecticut, Rhode Island, Vermont, New Hampshire, Maine)",
  southeast: "SOUTHEAST (Florida, Georgia, Alabama, Tennessee, Kentucky, North Carolina, South Carolina, Virginia, West Virginia, Maryland, Delaware, DC)",
};

async function fetchWithTimeout(url: string, timeoutMs: number = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "MaxVelocityWeather/1.0 (weather@maxvelocity.tv)" }
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNWSForecast(office: string, gridX: number, gridY: number): Promise<any> {
  try {
    const url = `https://api.weather.gov/gridpoints/${office}/${gridX},${gridY}/forecast`;
    const response = await fetchWithTimeout(url, 10000);
    if (!response.ok) {
      console.log(`NWS ${office} returned ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch NWS forecast for ${office}`);
    return null;
  }
}

function extractForecastDetails(periods: any[]): string {
  const details: string[] = [];

  for (let i = 0; i < Math.min(periods.length, 7); i++) {
    const period = periods[i];
    const name = period.name;
    const temp = period.temperature;
    const unit = period.temperatureUnit;
    const forecast = period.detailedForecast || period.shortForecast;
    const windSpeed = period.windSpeed || "";
    const windDir = period.windDirection || "";

    // Include wind info if available
    const windInfo = windSpeed ? ` Winds ${windDir} ${windSpeed}.` : "";

    details.push(`${name}: ${temp}°${unit}. ${forecast}${windInfo}`);
  }

  return details.join(" | ");
}

async function fetchCityForecast(city: CityConfig): Promise<{ city: string; forecast: string } | null> {
  const data = await fetchNWSForecast(city.office, city.gridX, city.gridY);
  if (!data?.properties?.periods) return null;

  const forecast = extractForecastDetails(data.properties.periods);
  return { city: city.name, forecast };
}

// Fetch SPC (Storm Prediction Center) Convective Outlooks
async function fetchSPCOutlook(): Promise<string> {
  try {
    const url = "https://www.spc.noaa.gov/products/outlook/day1otlk.html";
    const response = await fetchWithTimeout(url, 8000);
    if (!response.ok) return "";

    const text = await response.text();
    // Extract key info from SPC outlook
    const riskMatch = text.match(/CATEGORICAL\s+RISK[^<]*/i);
    return riskMatch ? `SPC Day 1 Outlook: ${riskMatch[0]}` : "";
  } catch {
    return "";
  }
}

// Fetch WPC (Weather Prediction Center) Short Range Discussion
async function fetchWPCProducts(): Promise<string> {
  const products: string[] = [];

  // Try to get various WPC products
  const productTypes = [
    { type: "SFP", name: "Short Range Forecast" },
  ];

  for (const product of productTypes) {
    try {
      const url = `https://api.weather.gov/products/types/${product.type}`;
      const response = await fetchWithTimeout(url, 6000);
      if (!response.ok) continue;

      const data = await response.json();
      const latestId = data?.["@graph"]?.[0]?.["@id"];
      if (!latestId) continue;

      const productResponse = await fetchWithTimeout(latestId, 6000);
      if (!productResponse.ok) continue;

      const productData = await productResponse.json();
      const text = productData?.productText;
      if (text) {
        // Extract just the summary/highlights portion (first ~2000 chars)
        products.push(`\n--- ${product.name} ---\n${text.substring(0, 2500)}`);
      }
    } catch {
      continue;
    }
  }

  return products.join("\n");
}

// Fetch active weather alerts for a region
async function fetchActiveAlerts(state: string): Promise<string[]> {
  try {
    const url = `https://api.weather.gov/alerts/active?area=${state}`;
    const response = await fetchWithTimeout(url, 6000);
    if (!response.ok) return [];

    const data = await response.json();
    const alerts = data?.features || [];

    return alerts.slice(0, 5).map((alert: any) => {
      const props = alert.properties;
      return `${props.event}: ${props.headline}`;
    });
  } catch {
    return [];
  }
}

// Fetch alerts for key states in each region
async function fetchRegionAlerts(): Promise<Record<string, string[]>> {
  const regionStates: Record<string, string[]> = {
    west_coast: ["WA", "OR", "CA"],
    rockies: ["CO", "WY", "MT"],
    great_plains: ["TX", "OK", "KS", "NE", "ND", "SD"],
    midwest: ["MN", "WI", "IL", "MI", "OH", "IN"],
    northeast: ["NY", "PA", "MA", "VT", "NH", "ME"],
    southeast: ["FL", "GA", "NC", "SC", "VA", "TN"],
  };

  const alertsByRegion: Record<string, string[]> = {};

  for (const [region, states] of Object.entries(regionStates)) {
    const allAlerts: string[] = [];
    // Just check first 2 states per region to limit API calls
    for (const state of states.slice(0, 2)) {
      const stateAlerts = await fetchActiveAlerts(state);
      allAlerts.push(...stateAlerts);
    }
    alertsByRegion[region] = [...new Set(allAlerts)].slice(0, 5); // Dedupe and limit
  }

  return alertsByRegion;
}

// Main function to get comprehensive weather context
export async function getWeatherContext(): Promise<string> {
  const startTime = Date.now();
  console.log("Fetching weather data from NWS...");

  const regionContexts: string[] = [];

  // Fetch alerts for all regions in parallel
  const alertsPromise = fetchRegionAlerts();

  // Fetch forecasts for each region
  for (const [regionId, cities] of Object.entries(REGION_CITIES)) {
    const regionName = REGION_NAMES[regionId] || regionId.toUpperCase();
    let regionContext = `\n=== ${regionName} ===\n`;

    // Fetch forecasts for cities in parallel (limit to 4 per region)
    const cityForecasts = await Promise.all(
      cities.slice(0, 4).map(city => fetchCityForecast(city))
    );

    const validForecasts = cityForecasts.filter(f => f !== null);

    if (validForecasts.length > 0) {
      for (const f of validForecasts) {
        regionContext += `\n${f!.city}:\n${f!.forecast}\n`;
      }
    } else {
      regionContext += "Forecast data temporarily unavailable for this region.\n";
    }

    regionContexts.push(regionContext);
  }

  // Wait for alerts
  const alerts = await alertsPromise;

  // Build alerts section
  let alertsContext = "\n=== ACTIVE WEATHER ALERTS ===\n";
  for (const [region, regionAlerts] of Object.entries(alerts)) {
    if (regionAlerts.length > 0) {
      alertsContext += `\n${region.toUpperCase()}:\n`;
      for (const alert of regionAlerts) {
        alertsContext += `- ${alert}\n`;
      }
    }
  }

  console.log(`Weather data fetched in ${(Date.now() - startTime) / 1000}s`);

  const today = new Date();
  const dayNames = [
    today.toLocaleDateString("en-US", { weekday: "long" }),
    new Date(today.getTime() + 86400000).toLocaleDateString("en-US", { weekday: "long" }),
    new Date(today.getTime() + 172800000).toLocaleDateString("en-US", { weekday: "long" }),
  ];

  const context = `
=====================================================================
NATIONAL WEATHER SERVICE DATA - ${new Date().toISOString()}
=====================================================================

Today is ${dayNames[0]}. Day 1 = ${dayNames[0]}, Day 2 = ${dayNames[1]}, Day 3 = ${dayNames[2]}.

${alertsContext}

=== CITY FORECASTS BY REGION ===
${regionContexts.join("\n")}

=====================================================================
INSTRUCTIONS FOR FORECAST GENERATION
=====================================================================
- Use the ACTUAL weather data above to generate your forecasts
- Pay attention to ACTIVE ALERTS - these indicate significant weather
- Include SPECIFIC temperatures, precipitation amounts, and wind speeds from the NWS data
- For snow events, use the accumulation amounts from the forecasts
- For each region, synthesize the city forecasts into a coherent regional summary
- The risk_scale should reflect the severity of ANY alerts and forecast conditions
- If there are Winter Storm Warnings or Watches, risk should be at least 5-6
- If there are Blizzard Warnings, risk should be at least 7-8
- You MUST generate forecast data for ALL 6 regions in this exact order: west_coast, rockies, great_plains, midwest, northeast, southeast
`;

  return context;
}
