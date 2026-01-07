import { NextRequest, NextResponse } from 'next/server';
import { getCityById } from '@/lib/cities';
import { fetchOpenMeteoForecast, weatherCodeToCondition } from '@/lib/openMeteo';
import { getRiskLevel } from '@/lib/riskScore';
import { computeCityRisk, CityDayInput } from '@/lib/riskScoring';
import { getOverlaysForCity } from '@/lib/overlayLookup';
import { getIceAccumulationForCityDays } from '@/lib/nwsIceFetcher';
import { CityDetailForecast, CityHourlyData, CityDailySummary, CityDailyRisk, ScoreBreakdown, OverlayMetadata } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * GET /api/city?city_id=xxx
 * Returns detailed forecast for a specific city
 */
export async function GET(request: NextRequest) {
  const cityId = request.nextUrl.searchParams.get('city_id');

  if (!cityId) {
    return NextResponse.json({ error: 'city_id is required' }, { status: 400 });
  }

  const city = getCityById(cityId);
  if (!city) {
    return NextResponse.json({ error: 'City not found' }, { status: 404 });
  }

  try {
    // Fetch weather, overlays, and ice data in parallel
    const [weatherData, overlaysDay1, overlaysDay2, overlaysDay3, iceData] = await Promise.all([
      fetchOpenMeteoForecast(city.lat, city.lon, {
        hourly: true,
        daily: true,
        days: 7,
      }),
      getOverlaysForCity(cityId, city.lat, city.lon, 1),
      getOverlaysForCity(cityId, city.lat, city.lon, 2),
      getOverlaysForCity(cityId, city.lat, city.lon, 3),
      getIceAccumulationForCityDays(cityId, city.lat, city.lon, 7).catch(() => []),
    ]);

    const overlaysByDay = [overlaysDay1, overlaysDay2, overlaysDay3];
    const data = weatherData;
    // Build a map of date -> ice accumulation for quick lookup
    const iceByDate = new Map(iceData.map(d => [d.date, d.ice_in]));

    // Process hourly data (48 hours)
    const hourly: CityHourlyData[] = (data.hourly?.time || []).slice(0, 48).map((time, i) => ({
      time,
      temperature: data.hourly?.temperature_2m?.[i] || 0,
      precipitation: data.hourly?.precipitation?.[i] || 0,
      windGust: data.hourly?.wind_gusts_10m?.[i] || 0,
      snowfall: data.hourly?.snowfall?.[i] || 0,
    }));

    // Process daily summary
    const dailySummary: CityDailySummary[] = (data.daily?.time || []).map((date, i) => ({
      date_local: date,
      tmax: data.daily?.temperature_2m_max?.[i] || 70,
      tmin: data.daily?.temperature_2m_min?.[i] || 50,
      snow_total: data.daily?.snowfall_sum?.[i] || 0,
      rain_total: data.daily?.precipitation_sum?.[i] || 0,
      wind_gust_max: data.daily?.wind_gusts_10m_max?.[i] || 0,
      conditions: {
        primary: weatherCodeToCondition(data.daily?.weather_code?.[i] || 0),
      },
    }));

    // Calculate daily risks using canonical computeCityRisk
    // IMPORTANT: Do NOT pass hourly data here - must match /api/regions computation exactly
    // Both endpoints must use daily-only inputs for consistent cityRisk scores
    const dailyRisks: CityDailyRisk[] = (data.daily?.time || []).map((date, i) => {
      const dayIndex = i + 1;

      // Get NBM ice accumulation for this day
      const iceIn = iceByDate.get(date) || 0;

      // Use only daily data (same as /api/regions) for consistent cityRisk
      const cityInput: CityDayInput = {
        tmax_f: data.daily?.temperature_2m_max?.[i] || 70,
        tmin_f: data.daily?.temperature_2m_min?.[i] || 50,
        wind_gust_mph: data.daily?.wind_gusts_10m_max?.[i] || 0,
        rain_in: data.daily?.precipitation_sum?.[i] || 0,
        snow_in: data.daily?.snowfall_sum?.[i] || 0,
        ice_in: iceIn,  // NBM ice accumulation (FRAM)
        // NOTE: hourly data intentionally omitted to match /api/regions
        // computeCityRisk will estimate rates from daily totals
      };

      // Get pre-fetched SPC/ERO overlays for this city and day (days 1-3 only)
      const overlayData = dayIndex <= 3 ? overlaysByDay[dayIndex - 1] : undefined;
      const overlays = overlayData?.combined;

      // Compute city risk WITH overlays and regionId for ice multipliers
      const riskResult = computeCityRisk(dayIndex, cityInput, overlays, city.regionId);

      // Extract SPC, WPC, and WSSI points from factors for score_breakdown
      const spcFactor = riskResult.factors.find(f => f.id === 'spc_outlook');
      const wpcFactor = riskResult.factors.find(f => f.id === 'wpc_ero');
      const wssiFactor = riskResult.factors.find(f => f.id === 'wpc_wssi');
      const spcPoints = spcFactor?.points || 0;
      const wpcPoints = wpcFactor?.points || 0;
      const wssiPoints = wssiFactor?.points || 0;
      const weatherPoints = riskResult.score_raw - spcPoints - wpcPoints - wssiPoints;

      const scoreBreakdown: ScoreBreakdown = {
        spcPoints,
        wpcPoints,
        wssiPoints,
        weatherPoints: Math.max(0, weatherPoints),
        total: riskResult.score_display,
      };

      // Build overlay metadata for API response (days 1-3 only)
      const overlayMeta: OverlayMetadata | undefined = overlayData ? {
        spc_category: overlayData.spc.category,
        spc_points: overlayData.spc.points,
        spc_source_url: overlayData.spc.source_url,
        spc_valid_time: overlayData.spc.valid_time,
        spc_status: overlayData.spc.status,
        ero_category: overlayData.ero.category,
        ero_points: overlayData.ero.points,
        ero_source_url: overlayData.ero.source_url,
        ero_valid_time: overlayData.ero.valid_time,
        ero_status: overlayData.ero.status,
        wssi_category: overlayData.wssi.category,
        wssi_points: overlayData.wssi.points,
        wssi_source_url: overlayData.wssi.source_url,
        wssi_valid_time: overlayData.wssi.valid_time,
        wssi_issue_time: overlayData.wssi.issue_time,
        wssi_status: overlayData.wssi.status,
      } : undefined;

      return {
        date,
        score_raw: riskResult.score_raw,
        score_display: riskResult.score_display,
        level: riskResult.level,
        score_breakdown: scoreBreakdown,
        overlay: overlayMeta,
        explain: {
          summary_text: riskResult.summary,
          top_drivers: riskResult.top_drivers.map(f => ({
            hazard: f.label,
            score: f.points,
            observation: f.observed,
          })),
          breakdown: riskResult.factors
            .filter(f => f.points >= 0.1)
            .map(f => ({
              hazard: f.label,
              category: f.category,
              score: f.points,
              observed: f.observed,
              notes: f.notes,
            })),
        },
      };
    });

    // Calculate risk trend
    const scores = dailyRisks.slice(0, 3).map(d => d.score_raw);
    let riskTrend: 'rising' | 'falling' | 'steady' = 'steady';
    if (scores.length >= 2) {
      const diff = scores[scores.length - 1] - scores[0];
      if (diff > 0.5) riskTrend = 'rising';
      else if (diff < -0.5) riskTrend = 'falling';
    }

    // Calculate 48h metrics
    const snow24h = hourly.slice(0, 24).reduce((sum, h) => sum + (h.snowfall || 0), 0);
    const snow48h = hourly.reduce((sum, h) => sum + (h.snowfall || 0), 0);
    const rain24h = hourly.slice(0, 24).reduce((sum, h) => sum + h.precipitation, 0);
    const rain48h = hourly.reduce((sum, h) => sum + h.precipitation, 0);
    const maxGust24h = Math.max(...hourly.slice(0, 24).map(h => h.windGust));
    const maxGust48h = Math.max(...hourly.map(h => h.windGust));
    const temps = hourly.map(h => h.temperature);

    const cityForecast: CityDetailForecast = {
      city,
      regionId: city.regionId,
      metrics: {
        tempMax48h: Math.max(...temps),
        tempMin48h: Math.min(...temps),
        snow24h,
        snow48h,
        rain24h,
        rain48h,
        maxGust24h,
        maxGust48h,
      },
      hourly,
      dailySummary,
      dailyRisks,
      riskTrend,
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(
      { city: cityForecast },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=900',
        },
      }
    );
  } catch (error) {
    console.error('City API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch city data' },
      { status: 500 }
    );
  }
}
