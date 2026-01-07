import { NextResponse } from 'next/server';
import { REGIONS, REGION_IDS } from '@/lib/regions';
import { fetchOpenMeteoForecast, weatherCodeToCondition } from '@/lib/openMeteo';
import { getRiskLevel, calculateRiskScore } from '@/lib/riskScore';
import { RegionForecast, ForecastResponse, NationalForecast, DayRisk, HazardInfo } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/forecast
 * Returns weather forecast data for all regions with risk scores
 */
export async function GET() {
  try {
    const regionForecasts: RegionForecast[] = [];

    // Fetch forecasts for all regions in parallel
    const forecastPromises = REGION_IDS.map(async (regionId) => {
      const region = REGIONS[regionId];

      try {
        const data = await fetchOpenMeteoForecast(region.center.lat, region.center.lon, {
          hourly: false,
          daily: true,
          days: 7,
        });

        // Process daily data
        const days: DayRisk[] = (data.daily?.time || []).map((date, i) => {
          const snow = data.daily?.snowfall_sum?.[i] || 0;
          const rain = data.daily?.precipitation_sum?.[i] || 0;
          const wind = data.daily?.wind_gusts_10m_max?.[i] || 0;
          const tmax = data.daily?.temperature_2m_max?.[i] || 70;
          const tmin = data.daily?.temperature_2m_min?.[i] || 50;

          const hazards: HazardInfo[] = [];

          if (snow >= 1) {
            hazards.push({
              hazard: 'Snow',
              score: snow >= 12 ? 7 : snow >= 6 ? 5 : snow >= 3 ? 4 : 2.5,
              rawValue: snow,
              unit: '"',
            });
          }

          if (rain >= 0.5) {
            hazards.push({
              hazard: 'Rain',
              score: rain >= 2 ? 5 : rain >= 1 ? 3.5 : 2.5,
              rawValue: rain,
              unit: '"',
            });
          }

          if (wind >= 30) {
            hazards.push({
              hazard: 'Wind',
              score: wind >= 60 ? 6 : wind >= 45 ? 4.5 : 3,
              rawValue: wind,
              unit: ' mph',
            });
          }

          // Pass day index (1-based) for long-range damping
          const score = calculateRiskScore({
            snowfall: snow,
            rainfall: rain,
            windGust: wind,
            tempMin: tmin,
            tempMax: tmax,
          }, i + 1);

          return {
            date,
            score,
            level: getRiskLevel(score),
            hazards,
          };
        });

        // Calculate overall risk (weighted average, emphasizing near-term)
        const weights = [0.35, 0.25, 0.15, 0.1, 0.05, 0.05, 0.05];
        const overallScore = days.reduce((acc, day, i) => acc + day.score * (weights[i] || 0.05), 0);

        // Get summary stats
        const allSnow = data.daily?.snowfall_sum || [];
        const allPrecip = data.daily?.precipitation_sum || [];
        const allWind = data.daily?.wind_gusts_10m_max || [];
        const allTmax = data.daily?.temperature_2m_max || [];
        const allTmin = data.daily?.temperature_2m_min || [];

        const forecast: RegionForecast = {
          region: {
            id: regionId,
            name: region.name,
          },
          risk: {
            overall: Math.round(overallScore * 10) / 10,
            level: getRiskLevel(overallScore),
            headline: days[0]?.hazards[0]?.hazard
              ? `${days[0].hazards[0].hazard} expected`
              : 'Quiet conditions',
            days,
          },
          summary: {
            tempRange: {
              min: Math.min(...allTmin),
              max: Math.max(...allTmax),
            },
            totalSnow: allSnow.reduce((a, b) => a + b, 0),
            totalPrecip: allPrecip.reduce((a, b) => a + b, 0),
            maxWindGust: Math.max(...allWind),
          },
        };

        return forecast;
      } catch (error) {
        console.error(`Error fetching forecast for ${regionId}:`, error);
        // Return a fallback forecast
        return {
          region: { id: regionId, name: region.name },
          risk: {
            overall: 1,
            level: 'quiet' as const,
            headline: 'Data unavailable',
            days: [],
          },
          summary: {
            tempRange: { min: 50, max: 70 },
            totalSnow: 0,
            totalPrecip: 0,
            maxWindGust: 0,
          },
        };
      }
    });

    const forecasts = await Promise.all(forecastPromises);
    regionForecasts.push(...forecasts);

    // Calculate national overview
    const allScores = regionForecasts.map((f) => f.risk.overall);
    const nationalScore = Math.max(...allScores);
    const activeRegions = regionForecasts
      .filter((f) => f.risk.overall >= 3)
      .map((f) => f.region.id);

    const national: NationalForecast = {
      overallRisk: nationalScore,
      level: getRiskLevel(nationalScore),
      activeRegions,
    };

    const response: ForecastResponse = {
      national,
      regions: regionForecasts,
      meta: {
        fetchedAt: new Date().toISOString(),
        models: ['open-meteo'],
      },
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=900',
      },
    });
  } catch (error) {
    console.error('Forecast API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch forecast data' },
      { status: 500 }
    );
  }
}
