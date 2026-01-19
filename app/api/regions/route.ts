import { NextResponse } from 'next/server';
import { REGIONS, REGION_IDS } from '@/lib/regions';
import { getCitiesByRegion } from '@/lib/cities';
import { fetchOpenMeteoForecast, weatherCodeToCondition } from '@/lib/openMeteo';
import { getRiskLevel } from '@/lib/riskScore';
import {
  computeCityRisk,
  computeRegionRisk,
  computeNationalRisk,
  extractRegionRiskInput,
  computeRegionMetrics,
  CityDayInput,
  CityRiskInput,
  CityOverlays,
  RegionRiskInput,
  RiskScoreResult,
} from '@/lib/riskScoring';
import { getOverlaysForCities, CityOverlayData } from '@/lib/overlayLookup';
import { getIceAccumulationForCities, DailyIceAccumulation, getIceAccumulationForCityDays } from '@/lib/nwsIceFetcher';
import {
  RegionId,
  CityMetricsSummary,
  RegionCitiesResponse,
  RegionsAPIResponse,
  RegionDailyData,
  RiskDriver,
  RiskBreakdownItem,
  ScoreBreakdown,
  OverlayMetadata,
} from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/regions
 * Returns all regions with cities and risk data
 */
export async function GET() {
  try {
    const regionsData: RegionCitiesResponse[] = [];
    // Store region risk results for national aggregation: [{ regionId, results: RiskScoreResult[], cities }]
    const allRegionRiskResults: { regionId: RegionId; results: RiskScoreResult[]; cities: CityMetricsSummary[] }[] = [];

    // Process each region
    for (const regionId of REGION_IDS) {
      const cities = getCitiesByRegion(regionId);
      const citySummaries: CityMetricsSummary[] = [];

      // Pre-fetch SPC/ERO/WSSI overlays for all cities in this region (all 7 days)
      // Days 1-3: SPC, ERO, WSSI
      // Days 4-7: SPC Day 4-8 probabilistic outlook
      // This is more efficient than fetching per-city
      const cityCoords = cities.map(c => ({ cityId: c.id, lat: c.lat, lon: c.lon }));
      const [overlaysDay1, overlaysDay2, overlaysDay3, overlaysDay4, overlaysDay5, overlaysDay6, overlaysDay7] = await Promise.all([
        getOverlaysForCities(cityCoords, 1),
        getOverlaysForCities(cityCoords, 2),
        getOverlaysForCities(cityCoords, 3),
        getOverlaysForCities(cityCoords, 4),
        getOverlaysForCities(cityCoords, 5),
        getOverlaysForCities(cityCoords, 6),
        getOverlaysForCities(cityCoords, 7),
      ]);
      const overlaysByDay: Map<string, CityOverlayData>[] = [overlaysDay1, overlaysDay2, overlaysDay3, overlaysDay4, overlaysDay5, overlaysDay6, overlaysDay7];

      // Pre-fetch NBM ice accumulation for all cities in this region (7 days)
      // Note: Ice data is fetched in parallel with weather data per city below
      // since NWS gridpoints API provides daily ice for multiple days in one call
      const cityIceDataMap = new Map<string, DailyIceAccumulation[]>();
      try {
        const icePromises = cities.map(async (city) => {
          const iceData = await getIceAccumulationForCityDays(city.id, city.lat, city.lon, 7);
          return { cityId: city.id, iceData };
        });
        const iceResults = await Promise.all(icePromises);
        iceResults.forEach(result => {
          cityIceDataMap.set(result.cityId, result.iceData);
        });
      } catch (iceError) {
        console.warn('Failed to fetch ice data for region:', regionId, iceError);
        // Continue without ice data - scores will still work
      }

      // Fetch weather for all cities
      const BATCH_SIZE = 15;
      const cityPromises = cities.map(async (city) => {
        try {
          const data = await fetchOpenMeteoForecast(city.lat, city.lon, {
            hourly: false,
            daily: true,
            days: 7,
          });

          const daily = data.daily;
          if (!daily) {
            return {
              id: city.id,
              cityId: city.id,
              name: city.name,
              state: city.state,
              regionId: city.regionId,
              lat: city.lat,
              lon: city.lon,
              available: false,
              tempMax48h: 0,
              tempMin48h: 0,
              snow24h: 0,
              rain24h: 0,
              maxGust48h: 0,
              days: [],
            } as CityMetricsSummary;
          }

          // Build daily summary
          const dailySummary = daily.time.map((date, i) => ({
            date_local: date,
            tmax: daily.temperature_2m_max?.[i] || 70,
            tmin: daily.temperature_2m_min?.[i] || 50,
            snow_total: daily.snowfall_sum?.[i] || 0,
            rain_total: daily.precipitation_sum?.[i] || 0,
            wind_gust_max: daily.wind_gusts_10m_max?.[i] || 0,
            conditions: {
              primary: weatherCodeToCondition(daily.weather_code?.[i] || 0),
            },
          }));

          // Build daily risks using canonical computeCityRisk
          const dailyRisks = daily.time.map((date, i) => {
            const dayIndex = i + 1;
            // Get NBM ice accumulation for this day
            const cityIceData = cityIceDataMap.get(city.id) || [];
            const dayIce = cityIceData.find(d => d.date === date);
            const iceIn = dayIce?.ice_in || 0;

            const cityInput: CityDayInput = {
              tmax_f: daily.temperature_2m_max?.[i] || 70,
              tmin_f: daily.temperature_2m_min?.[i] || 50,
              wind_gust_mph: daily.wind_gusts_10m_max?.[i] || 0,
              rain_in: daily.precipitation_sum?.[i] || 0,
              snow_in: daily.snowfall_sum?.[i] || 0,
              ice_in: iceIn,
            };

            // Get pre-fetched overlays for this city and day (all 7 days)
            // Days 1-3: SPC, ERO, WSSI
            // Days 4-7: SPC Day 4-8 probabilistic outlook
            const overlayData = dayIndex <= 7 ? overlaysByDay[dayIndex - 1]?.get(city.id) : undefined;
            const overlays = overlayData?.combined;

            // Compute city risk WITH overlays and regionId for ice multipliers
            const riskResult = computeCityRisk(dayIndex, cityInput, overlays, city.regionId);

            // Extract SPC, WPC, WSSI, and SPC Day 4-8 points from factors for score_breakdown
            const spcFactor = riskResult.factors.find(f => f.id === 'spc_outlook');
            const spcDay48Factor = riskResult.factors.find(f => f.id === 'spc_day48_outlook');
            const wpcFactor = riskResult.factors.find(f => f.id === 'wpc_ero');
            const wssiFactor = riskResult.factors.find(f => f.id === 'wpc_wssi');
            const spcPoints = spcFactor?.points || 0;
            const spcDay48Points = spcDay48Factor?.points || 0;
            const wpcPoints = wpcFactor?.points || 0;
            const wssiPoints = wssiFactor?.points || 0;
            // Combine SPC Day 1-3 and Day 4-8 points for the breakdown (only one will be non-zero)
            const totalSpcPoints = spcPoints + spcDay48Points;
            const weatherPoints = riskResult.score_raw - totalSpcPoints - wpcPoints - wssiPoints;

            const scoreBreakdown: ScoreBreakdown = {
              spcPoints: totalSpcPoints,  // Combined SPC D1-3 and D4-8
              wpcPoints,
              wssiPoints,
              weatherPoints: Math.max(0, weatherPoints),
              total: riskResult.score_display,
            };

            // Build overlay metadata for API response
            // Days 1-3: SPC, ERO, WSSI
            // Days 4-7: SPC Day 4-8
            const overlayMeta: OverlayMetadata | undefined = overlayData ? {
              spc_category: overlayData.spc.category,
              spc_points: overlayData.spc.points,
              spc_source_url: overlayData.spc.source_url,
              spc_valid_time: overlayData.spc.valid_time,
              spc_status: overlayData.spc.status,
              // SPC Day 4-8 fields
              spc_day48_category: overlayData.spcDay48?.category,
              spc_day48_dn: overlayData.spcDay48?.dn,
              spc_day48_points: overlayData.spcDay48?.points,
              spc_day48_source_url: overlayData.spcDay48?.source_url,
              spc_day48_valid_time: overlayData.spcDay48?.valid_time,
              spc_day48_status: overlayData.spcDay48?.status,
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
              // Store full factors for region aggregation
              _factors: riskResult.factors,
              // Store overlay info for region aggregation
              _overlays: overlays,
              _overlayData: overlayData,
              // Store city input (including ice) for region aggregation
              _cityInput: cityInput,
            };
          });

          const summary: CityMetricsSummary = {
            id: city.id,
            cityId: city.id,
            name: city.name,
            state: city.state,
            regionId: city.regionId,
            lat: city.lat,
            lon: city.lon,
            available: true,
            tempMax48h: Math.max(daily.temperature_2m_max?.[0] || 0, daily.temperature_2m_max?.[1] || 0),
            tempMin48h: Math.min(daily.temperature_2m_min?.[0] || 100, daily.temperature_2m_min?.[1] || 100),
            snow24h: daily.snowfall_sum?.[0] || 0,
            rain24h: daily.precipitation_sum?.[0] || 0,
            maxGust48h: Math.max(daily.wind_gusts_10m_max?.[0] || 0, daily.wind_gusts_10m_max?.[1] || 0),
            riskScore: dailyRisks[0]?.score_display,
            dailySummary,
            dailyRisks,
            days: dailyRisks.map(dr => ({
              risk: dr.score_display,
              condition: dailySummary[dailyRisks.indexOf(dr)]?.conditions?.primary || 'Clear'
            })),
          };

          return summary;
        } catch (error) {
          console.error(`Error fetching city ${city.id}:`, error);
          return {
            id: city.id,
            cityId: city.id,
            name: city.name,
            state: city.state,
            regionId: city.regionId,
            lat: city.lat,
            lon: city.lon,
            available: false,
            tempMax48h: 0,
            tempMin48h: 0,
            snow24h: 0,
            rain24h: 0,
            maxGust48h: 0,
            days: [],
          } as CityMetricsSummary;
        }
      });

      const cityResults = await Promise.all(cityPromises);
      citySummaries.push(...cityResults);

      // Calculate region-level risk from city data using canonical pipeline
      const availableCities = citySummaries.filter((c) => c.available);

      // Build region daily data using canonical computeRegionRisk
      const regionDaily: RegionDailyData[] = [];
      const regionRiskResults: RiskScoreResult[] = [];

      if (availableCities.length > 0 && availableCities[0]?.dailyRisks) {
        for (let dayIdx = 1; dayIdx <= 7; dayIdx++) {
          const i = dayIdx - 1;

          // Build CityRiskInput for this day
          const cityRiskInputs: CityRiskInput[] = availableCities
            .filter(c => c.dailySummary?.[i] && c.dailyRisks?.[i])
            .map(c => {
              // Get stored overlay and ice data from the daily risk computation
              const dailyRisk = c.dailyRisks![i] as any;
              const overlays = dailyRisk._overlays as CityOverlays | undefined;
              // Get ice from the stored cityInput that was used for risk calculation
              const iceIn = dailyRisk._cityInput?.ice_in || 0;

              return {
                cityId: c.cityId,
                cityName: c.name,
                state: c.state,
                score: c.dailyRisks![i].score_display,
                level: c.dailyRisks![i].level as any,
                tmax_f: c.dailySummary![i].tmax,
                tmin_f: c.dailySummary![i].tmin,
                wind_gust_mph: c.dailySummary![i].wind_gust_max,
                rain_in: c.dailySummary![i].rain_total,
                snow_in: c.dailySummary![i].snow_total,
                ice_in: iceIn,  // NBM ice accumulation
                // Pass SPC/ERO/WSSI categories from computed overlays (Days 1-3)
                spcCategory: overlays?.spcCategory,
                eroCategory: overlays?.eroCategory,
                wssiCategory: overlays?.wssiCategory,
                // Pass SPC Day 4-8 categories (Days 4-7)
                spcDay48Category: overlays?.spcDay48Category,
                spcDay48Dn: overlays?.spcDay48Dn,
              };
            });

          // Compute region risk using canonical function
          // Pass regionId for regional multipliers (SE/Southern Plains 2x snow/ice, NE 0.75x snow)
          const regionRiskResult = computeRegionRisk(dayIdx, cityRiskInputs, undefined, regionId);
          regionRiskResults.push(regionRiskResult);

          // Extract SPC debug info from factors
          const spcFactor = regionRiskResult.factors.find(f => f.id === 'spc_overlay');
          const spcDebug = spcFactor?.meta as {
            max_spc_category?: string;
            max_spc_city?: string;
            avg_spc_points?: number;
            city_breakdown?: Array<{ cityId: string; cityName: string; category: string }>;
          } | undefined;

          // Build API response format
          regionDaily.push({
            date: availableCities[0].dailySummary?.[i]?.date_local || '',
            score: regionRiskResult.score_raw,
            score_display: regionRiskResult.score_display,
            level: regionRiskResult.level,
            // SPC debug info for verification
            spc_debug: spcDebug ? {
              max_spc_category: spcDebug.max_spc_category,
              max_spc_city: spcDebug.max_spc_city,
              avg_spc_points: spcDebug.avg_spc_points,
              city_breakdown: spcDebug.city_breakdown?.slice(0, 10), // Top 10 cities
            } : undefined,
            explain: {
              summary_text: regionRiskResult.summary,
              top_drivers: regionRiskResult.top_drivers.map(f => ({
                hazard: f.label,
                score: f.points,
                observation: f.observed,
              })),
              breakdown: regionRiskResult.factors
                .filter(f => f.points >= 0.1)
                .map(f => ({
                  hazard: f.label,
                  category: f.category,
                  score: f.points,
                  observed: f.observed,
                  notes: f.notes,
                  meta: f.meta, // Include meta for debugging
                })),
            },
          });
        }
      }

      // Region overall score = Day 1 score (or max of first 3 days for significant events)
      const regionScore = regionRiskResults.length > 0
        ? Math.max(
            regionRiskResults[0]?.score_display || 1,
            (regionRiskResults[1]?.score_display || 1) * 0.9,  // Day 2 weighted less
            (regionRiskResults[2]?.score_display || 1) * 0.8   // Day 3 weighted even less
          )
        : 1;

      regionsData.push({
        regionId,
        riskScore: Math.round(regionScore * 10) / 10,
        riskLevel: getRiskLevel(regionScore),
        cities: citySummaries,
        daily: regionDaily,
        explain: regionRiskResults[0] ? {
          summary_text: regionRiskResults[0].summary,
          top_drivers: regionRiskResults[0].top_drivers.map(f => ({
            hazard: f.label,
            score: f.points,
            observation: f.observed,
          })),
          breakdown: regionRiskResults[0].factors
            .filter(f => f.points >= 0.1)
            .map(f => ({
              hazard: f.label,
              category: f.category,
              score: f.points,
              observed: f.observed,
              notes: f.notes,
            })),
        } : undefined,
      });

      // Store region risk results for national aggregation
      allRegionRiskResults.push({ regionId, results: regionRiskResults, cities: availableCities });
    }

    // Calculate national overview using canonical computeNationalRisk
    const activeRegions = regionsData
      .filter((r) => r.riskScore >= 3)
      .map((r) => r.regionId);

    // Compute national metrics for each day using canonical pipeline
    const nationalDaily: RegionDailyData[] = [];
    let nationalOverallScore = 1;

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      const date = regionsData[0]?.daily?.[dayIdx]?.date || '';

      // Build RegionRiskInput array for this day from stored region results
      const regionRiskInputs: RegionRiskInput[] = allRegionRiskResults
        .filter(r => r.results[dayIdx])
        .map(r => {
          const result = r.results[dayIdx];
          const regionName = REGIONS[r.regionId]?.name || r.regionId;

          // Extract factor points from region result
          const getPoints = (id: string) => result.factors.find(f => f.id === id)?.points || 0;

          // Count cities with various conditions for this day
          const citiesForDay = r.cities.filter(c => c.dailySummary?.[dayIdx]);
          const cityCount = citiesForDay.length;

          // Count cities with SPC/ERO/WSSI overlays for this day (Days 1-3)
          const citiesWithSPC = citiesForDay.filter(c => {
            const dailyRisk = c.dailyRisks?.[dayIdx] as any;
            return dailyRisk?._overlays?.spcCategory;
          }).length;
          const citiesWithERO = citiesForDay.filter(c => {
            const dailyRisk = c.dailyRisks?.[dayIdx] as any;
            return dailyRisk?._overlays?.eroCategory;
          }).length;
          const citiesWithWSSI = citiesForDay.filter(c => {
            const dailyRisk = c.dailyRisks?.[dayIdx] as any;
            return dailyRisk?._overlays?.wssiCategory;
          }).length;
          // Count cities with SPC Day 4-8 overlays for this day
          const citiesWithSPCDay48 = citiesForDay.filter(c => {
            const dailyRisk = c.dailyRisks?.[dayIdx] as any;
            return dailyRisk?._overlays?.spcDay48Category;
          }).length;

          // Count cities with ice accumulation
          const citiesWithIce = citiesForDay.filter(c => {
            const dailyRisk = c.dailyRisks?.[dayIdx] as any;
            return (dailyRisk?._cityInput?.ice_in || 0) >= 0.1;
          }).length;

          return {
            regionId: r.regionId,
            regionName,
            score: result.score_display,
            level: result.level,
            snowPoints: getPoints('snow_hazard'),
            rainPoints: getPoints('rain_hazard'),
            icePoints: getPoints('ice_hazard'),  // NBM ice accumulation
            windPoints: getPoints('wind_hazard'),
            coldPoints: getPoints('cold_hazard'),
            heatPoints: getPoints('heat_hazard'),
            spcPoints: getPoints('spc_overlay'),
            eroPoints: getPoints('wpc_ero_overlay'),
            wssiPoints: getPoints('wpc_wssi_overlay'),
            spcDay48Points: getPoints('spc_day48_overlay'),
            cityCount,
            citiesWithSnow: citiesForDay.filter(c => (c.dailySummary?.[dayIdx]?.snow_total || 0) >= 1).length,
            citiesWithRain: citiesForDay.filter(c => (c.dailySummary?.[dayIdx]?.rain_total || 0) >= 0.25).length,
            citiesWithIce,  // Cities with ice >= 0.1"
            citiesWithWind: citiesForDay.filter(c => (c.dailySummary?.[dayIdx]?.wind_gust_max || 0) >= 30).length,
            citiesWithSPC,
            citiesWithERO,
            citiesWithWSSI,
            citiesWithSPCDay48,
          };
        });

      if (regionRiskInputs.length > 0) {
        const nationalRiskResult = computeNationalRisk(dayIdx + 1, regionRiskInputs);

        nationalDaily.push({
          date,
          score: nationalRiskResult.score_raw,
          score_display: nationalRiskResult.score_display,
          level: nationalRiskResult.level,
          explain: {
            summary_text: nationalRiskResult.summary,
            top_drivers: nationalRiskResult.top_drivers.map(f => ({
              hazard: f.label,
              score: f.points,
              observation: f.observed,
            })),
            breakdown: nationalRiskResult.factors
              .filter(f => f.points >= 0.1)
              .map(f => ({
                hazard: f.label,
                category: f.category,
                score: f.points,
                observed: f.observed,
                notes: f.notes,
              })),
          },
        });

        // Day 1 is the overall national score
        if (dayIdx === 0) {
          nationalOverallScore = nationalRiskResult.score_display;
        }
      } else {
        nationalDaily.push({
          date,
          score: 1,
          score_display: 1,
          level: 'very-quiet',
        });
      }
    }

    const response: RegionsAPIResponse = {
      regions: regionsData,
      national: {
        overallRisk: Math.round(nationalOverallScore * 100) / 100, // 2 decimal precision for national
        level: getRiskLevel(nationalOverallScore),
        activeRegions,
        daily: nationalDaily,
        explain: nationalDaily[0]?.explain ? {
          score: nationalOverallScore,
          level: getRiskLevel(nationalOverallScore),
          summary_text: nationalDaily[0].explain.summary_text,
          top_drivers: nationalDaily[0].explain.top_drivers,
          breakdown: nationalDaily[0].explain.breakdown,
        } : undefined,
      },
      fetchedAt: new Date().toISOString(),
    };

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=900',
      },
    });
  } catch (error) {
    console.error('Regions API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch regions data' },
      { status: 500 }
    );
  }
}
