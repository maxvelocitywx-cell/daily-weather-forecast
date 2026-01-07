import { CityMetricsSummary, CityDailyRisk } from './types';

/**
 * Get the risk score for a city on a specific day
 */
export function getCityDayRiskScore(city: CityMetricsSummary, dayIndex: number): number {
  // Check daily risks first
  if (city.dailyRisks && city.dailyRisks[dayIndex]) {
    return city.dailyRisks[dayIndex].score_display ?? city.dailyRisks[dayIndex].score_raw;
  }

  // Fall back to overall risk score
  if (city.riskScore !== undefined) {
    return city.riskScore;
  }

  // Calculate basic score from metrics if no risk score available
  if (!city.available) return 0;

  let score = 1.0;

  const day = city.dailySummary?.[dayIndex];
  if (day) {
    // Snow impact
    if (day.snow_total >= 12) score = Math.max(score, 7.0);
    else if (day.snow_total >= 6) score = Math.max(score, 5.0);
    else if (day.snow_total >= 3) score = Math.max(score, 4.0);
    else if (day.snow_total >= 1) score = Math.max(score, 2.5);

    // Rain impact
    if (day.rain_total >= 2) score = Math.max(score, 5.0);
    else if (day.rain_total >= 1) score = Math.max(score, 3.5);

    // Wind impact
    if (day.wind_gust_max >= 60) score = Math.max(score, 6.0);
    else if (day.wind_gust_max >= 45) score = Math.max(score, 4.5);
    else if (day.wind_gust_max >= 35) score = Math.max(score, 3.0);
  } else {
    // Use 48h summary
    if (city.snow24h >= 6) score = Math.max(score, 5.0);
    else if (city.snow24h >= 3) score = Math.max(score, 4.0);

    if (city.rain24h >= 1) score = Math.max(score, 3.5);

    if (city.maxGust48h >= 50) score = Math.max(score, 5.0);
    else if (city.maxGust48h >= 40) score = Math.max(score, 4.0);
  }

  return score;
}

/**
 * Sort cities by risk score for a specific day (highest first)
 */
export function sortCitiesByDayRisk(
  cities: CityMetricsSummary[],
  dayIndex: number
): CityMetricsSummary[] {
  return [...cities].sort((a, b) => {
    const scoreA = getCityDayRiskScore(a, dayIndex);
    const scoreB = getCityDayRiskScore(b, dayIndex);
    return scoreB - scoreA;
  });
}

/**
 * Filter cities that have significant weather
 */
export function filterActiveCities(
  cities: CityMetricsSummary[],
  dayIndex: number,
  minScore: number = 2.5
): CityMetricsSummary[] {
  return cities.filter(city => {
    if (!city.available) return false;
    return getCityDayRiskScore(city, dayIndex) >= minScore;
  });
}

/**
 * Get the top N cities by risk for a day
 */
export function getTopCitiesByRisk(
  cities: CityMetricsSummary[],
  dayIndex: number,
  limit: number = 5
): CityMetricsSummary[] {
  return sortCitiesByDayRisk(cities, dayIndex).slice(0, limit);
}
