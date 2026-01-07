import { NextRequest, NextResponse } from 'next/server';
import { REGION_IDS } from '@/lib/regions';
import { getCitiesByRegion } from '@/lib/cities';
import { fetchOpenMeteoForecast } from '@/lib/openMeteo';
import { calculateCityDayRisk, CityDayMetrics } from '@/lib/cityRiskScore';
import { computeRegionDayMetrics, CityDayData, RegionDayMetrics } from '@/lib/regionMetrics';
import { generateRegionNarrative, NarrativeResult } from '@/lib/forecastNarratives';
import { RegionId } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RegionNarrativeResponse {
  regionId: RegionId;
  regionName: string;
  narratives: NarrativeResult[];
  metrics: RegionDayMetrics[];
}

/**
 * GET /api/region-narratives
 * Returns narratives for all regions, all 7 days
 * Optional query params: ?region=northeast&day=1
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const filterRegion = searchParams.get('region') as RegionId | null;
    const filterDay = searchParams.get('day') ? parseInt(searchParams.get('day')!) : null;

    const regionsToProcess = filterRegion
      ? [filterRegion]
      : REGION_IDS;

    const results: RegionNarrativeResponse[] = [];

    for (const regionId of regionsToProcess) {
      const cities = getCitiesByRegion(regionId);

      // Fetch weather data for cities (sample for performance)
      const sampleCities = cities.slice(0, 15); // Use 15 cities for narrative generation

      const cityDataPromises = sampleCities.map(async (city) => {
        try {
          const data = await fetchOpenMeteoForecast(city.lat, city.lon, {
            hourly: false,
            daily: true,
            days: 7,
          });
          return { city, data };
        } catch {
          return null;
        }
      });

      const cityResults = (await Promise.all(cityDataPromises)).filter(Boolean);

      // Build city day data for each day
      const metricsArray: RegionDayMetrics[] = [];
      const daysToProcess = filterDay ? [filterDay] : [1, 2, 3, 4, 5, 6, 7];

      for (const dayIdx of daysToProcess) {
        const i = dayIdx - 1;
        const cityDayDataArr: CityDayData[] = [];

        for (const result of cityResults) {
          if (!result) continue;
          const { city, data } = result;
          const daily = data.daily;
          if (!daily?.time?.[i]) continue;

          const metrics: CityDayMetrics = {
            tmax_f: daily.temperature_2m_max?.[i] || 70,
            tmin_f: daily.temperature_2m_min?.[i] || 50,
            wind_gust_mph: daily.wind_gusts_10m_max?.[i] || 0,
            rain_in: daily.precipitation_sum?.[i] || 0,
            snow_in: daily.snowfall_sum?.[i] || 0,
            weatherCode: daily.weather_code?.[i],
          };

          const riskResult = calculateCityDayRisk(metrics, dayIdx);

          cityDayDataArr.push({
            cityId: city.id,
            cityName: city.name,
            state: city.state,
            lat: city.lat,
            lon: city.lon,
            tmax_f: metrics.tmax_f,
            tmin_f: metrics.tmin_f,
            wind_gust_mph: metrics.wind_gust_mph,
            rain_in: metrics.rain_in,
            snow_in: metrics.snow_in,
            riskScore: riskResult.score_display,
            riskLevel: riskResult.level,
          });
        }

        const date = cityResults[0]?.data.daily?.time?.[i] || '';
        const dayMetrics = computeRegionDayMetrics(regionId, dayIdx, date, cityDayDataArr);
        metricsArray.push(dayMetrics);
      }

      // Generate narratives for each day
      const narratives: NarrativeResult[] = [];
      for (const metrics of metricsArray) {
        const narrative = await generateRegionNarrative(metrics);
        narratives.push(narrative);
      }

      results.push({
        regionId,
        regionName: getRegionName(regionId),
        narratives,
        metrics: metricsArray,
      });
    }

    return NextResponse.json({
      regions: results,
      generatedAt: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    console.error('Region narratives API error:', error);
    return NextResponse.json(
      { error: 'Failed to generate narratives' },
      { status: 500 }
    );
  }
}

function getRegionName(regionId: RegionId): string {
  const names: Record<RegionId, string> = {
    'northeast': 'Northeast',
    'southeast': 'Southeast',
    'midwest': 'Midwest',
    'southern_plains': 'Southern Plains',
    'northern_plains': 'Northern Plains',
    'northwest': 'Northwest',
    'southwest': 'Southwest',
  };
  return names[regionId] || regionId;
}
