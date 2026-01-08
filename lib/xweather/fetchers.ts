/**
 * Xweather Facts Fetchers
 *
 * Converts Xweather API responses into verified XweatherFact objects.
 * Every fact is validated before being added to the bundle.
 */

import {
  XweatherFact,
  XweatherFactType,
  XweatherConfidence,
  XweatherFactsBundle,
  XweatherObservation,
  XweatherStormReport,
  XweatherAlert,
  getStateName,
  getStateAbbrev,
} from './types';

import {
  fetchObservations,
  fetchStormReports,
  fetchAlerts,
} from './client';

// ============================================================================
// DEDUPLICATION
// ============================================================================

const DEDUPE_WINDOW_MS = 45 * 60 * 1000; // 45 minutes

interface DedupeKey {
  type: string;
  lat: number;
  lon: number;
  value: string;
  timeBucket: number;
}

function createDedupeKey(fact: XweatherFact): string {
  const roundedLat = Math.round(fact.location.lat * 100) / 100;
  const roundedLon = Math.round(fact.location.lon * 100) / 100;
  const timestamp = new Date(fact.timestamp_utc).getTime();
  const timeBucket = Math.floor(timestamp / DEDUPE_WINDOW_MS);
  const value = fact.value !== null ? String(fact.value) : 'null';

  return `${fact.type}|${roundedLat}|${roundedLon}|${value}|${timeBucket}`;
}

function deduplicateFacts(facts: XweatherFact[]): XweatherFact[] {
  const seen = new Set<string>();
  const result: XweatherFact[] = [];

  for (const fact of facts) {
    const key = createDedupeKey(fact);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(fact);
    }
  }

  return result;
}

// ============================================================================
// VALIDATION
// ============================================================================

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function validateFact(fact: Partial<XweatherFact>): ValidationResult {
  if (!fact.fact_id) return { valid: false, reason: 'Missing fact_id' };
  if (!fact.type) return { valid: false, reason: 'Missing type' };
  if (!fact.location) return { valid: false, reason: 'Missing location' };
  if (!fact.location.name) return { valid: false, reason: 'Missing location.name' };
  if (!fact.location.state) return { valid: false, reason: 'Missing location.state' };
  if (fact.location.lat === undefined) return { valid: false, reason: 'Missing location.lat' };
  if (fact.location.lon === undefined) return { valid: false, reason: 'Missing location.lon' };
  if (!fact.timestamp_utc) return { valid: false, reason: 'Missing timestamp_utc' };
  if (!fact.confidence) return { valid: false, reason: 'Missing confidence' };
  if (!fact.source_url) return { valid: false, reason: 'Missing source_url' };

  // Measured facts require a station_id or specific obs source
  if (fact.confidence === 'measured' && !fact.station_id) {
    // Allow if it's from a named station in the observation
    if (!fact.location.name) {
      return { valid: false, reason: 'Measured confidence requires station identification' };
    }
  }

  return { valid: true };
}

function generateFactId(prefix: string, ...parts: (string | number)[]): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  const suffix = parts.map(p => String(p).substring(0, 8)).join('-');
  return `${prefix}-${suffix}-${timestamp}-${random}`;
}

// ============================================================================
// OBSERVATION FACTS
// ============================================================================

function observationToFacts(obs: XweatherObservation): XweatherFact[] {
  const facts: XweatherFact[] = [];
  const rejectionReasons: string[] = [];

  if (!obs.ob || !obs.place || !obs.loc) {
    return facts;
  }

  const stateAbbrev = obs.place.state || '';
  const stateName = getStateName(stateAbbrev);
  const timestamp = obs.ob.dateTimeISO || new Date(obs.ob.timestamp * 1000).toISOString();
  const stationId = obs.id || obs.place.name;

  const baseLocation = {
    name: obs.place.name || 'Unknown',
    state: stateName,
    state_abbrev: stateAbbrev,
    lat: obs.loc.lat,
    lon: obs.loc.long,
  };

  const baseUrl = `https://www.xweather.com/observations/${stationId}`;

  // Wind Gust (>= 50 mph is significant)
  if (obs.ob.windGustMPH !== null && obs.ob.windGustMPH >= 50) {
    const fact: XweatherFact = {
      fact_id: generateFactId('obs-wind', stationId, obs.ob.windGustMPH),
      type: 'measured_wind',
      value: Math.round(obs.ob.windGustMPH),
      units: 'mph',
      location: baseLocation,
      timestamp_utc: timestamp,
      confidence: 'measured',
      source_name: 'Xweather',
      source_url: baseUrl,
      station_id: stationId,
      raw_data: `Wind gust: ${obs.ob.windGustMPH} mph from ${obs.ob.windDir}`,
    };

    const validation = validateFact(fact);
    if (validation.valid) {
      facts.push(fact);
    } else {
      rejectionReasons.push(`Obs wind ${stationId}: ${validation.reason}`);
    }
  }

  // Extreme Heat (>= 105°F)
  if (obs.ob.tempF !== null && obs.ob.tempF >= 105) {
    const fact: XweatherFact = {
      fact_id: generateFactId('obs-heat', stationId, obs.ob.tempF),
      type: 'measured_temp',
      value: Math.round(obs.ob.tempF),
      units: '°F',
      location: baseLocation,
      timestamp_utc: timestamp,
      confidence: 'measured',
      source_name: 'Xweather',
      source_url: baseUrl,
      station_id: stationId,
      raw_data: `Temperature: ${obs.ob.tempF}°F`,
    };

    const validation = validateFact(fact);
    if (validation.valid) {
      facts.push(fact);
    } else {
      rejectionReasons.push(`Obs heat ${stationId}: ${validation.reason}`);
    }
  }

  // Extreme Cold (<= 0°F)
  if (obs.ob.tempF !== null && obs.ob.tempF <= 0) {
    const fact: XweatherFact = {
      fact_id: generateFactId('obs-cold', stationId, obs.ob.tempF),
      type: 'measured_temp',
      value: Math.round(obs.ob.tempF),
      units: '°F',
      location: baseLocation,
      timestamp_utc: timestamp,
      confidence: 'measured',
      source_name: 'Xweather',
      source_url: baseUrl,
      station_id: stationId,
      raw_data: `Temperature: ${obs.ob.tempF}°F`,
    };

    const validation = validateFact(fact);
    if (validation.valid) {
      facts.push(fact);
    } else {
      rejectionReasons.push(`Obs cold ${stationId}: ${validation.reason}`);
    }
  }

  if (rejectionReasons.length > 0) {
    console.log('[Xweather Fetcher] Observation rejections:', rejectionReasons.slice(0, 3));
  }

  return facts;
}

export async function fetchObservationFacts(): Promise<XweatherFact[]> {
  console.log('[Xweather Fetcher] Fetching observation facts...');

  const observations = await fetchObservations();
  const facts: XweatherFact[] = [];

  for (const obs of observations) {
    const obsFacts = observationToFacts(obs);
    facts.push(...obsFacts);
  }

  const deduplicated = deduplicateFacts(facts);
  console.log(`[Xweather Fetcher] Observations: ${deduplicated.length} facts (from ${observations.length} obs)`);

  return deduplicated;
}

// ============================================================================
// STORM REPORT FACTS
// ============================================================================

function getReportType(report: XweatherStormReport): XweatherFactType {
  const type = report.report?.type?.toLowerCase() || '';
  const code = report.report?.code?.toLowerCase() || '';

  if (type.includes('tornado') || code === 't') return 'tornado_report';
  if (type.includes('hail') || code === 'h') return 'reported_hail';
  if (type.includes('wind') || code === 'w' || code === 'g') return 'reported_wind';
  if (type.includes('flood') || code === 'f') return 'flood_report';
  if (type.includes('snow') || type.includes('ice') || type.includes('winter')) return 'winter_event';
  if (type.includes('fire')) return 'fire_event';

  return 'general';
}

function stormReportToFact(report: XweatherStormReport): XweatherFact | null {
  if (!report.report || !report.place || !report.loc) {
    return null;
  }

  const stateAbbrev = report.place.state || '';
  const stateName = getStateName(stateAbbrev);
  const timestamp = report.report.dateTimeISO || new Date(report.report.timestamp * 1000).toISOString();
  const factType = getReportType(report);

  // Extract magnitude if available
  let value: number | string | null = null;
  let units: 'mph' | 'in' | '°F' | 'mb' | 'kt' | null = null;

  if (report.detail?.magnitude !== undefined) {
    value = report.detail.magnitude;
    const magUnit = report.detail.magUnit?.toLowerCase() || '';
    if (magUnit.includes('mph')) units = 'mph';
    else if (magUnit.includes('in')) units = 'in';
    else if (magUnit.includes('kt')) units = 'kt';
  }

  const fact: XweatherFact = {
    fact_id: generateFactId('report', report.id || factType, report.loc.lat),
    type: factType,
    value,
    units,
    location: {
      name: report.place.name || 'Unknown',
      state: stateName,
      state_abbrev: stateAbbrev,
      lat: report.loc.lat,
      lon: report.loc.long,
    },
    timestamp_utc: timestamp,
    confidence: 'reported',
    source_name: 'Xweather',
    source_url: `https://www.xweather.com/stormreports`,
    raw_data: report.report.comments || `${report.report.name}: ${report.report.cat}`,
  };

  const validation = validateFact(fact);
  if (!validation.valid) {
    console.log(`[Xweather Fetcher] Storm report rejected: ${validation.reason}`);
    return null;
  }

  return fact;
}

export async function fetchStormReportFacts(hoursBack: number = 6): Promise<XweatherFact[]> {
  console.log(`[Xweather Fetcher] Fetching storm reports (last ${hoursBack}h)...`);

  const reports = await fetchStormReports(hoursBack);
  const facts: XweatherFact[] = [];

  for (const report of reports) {
    const fact = stormReportToFact(report);
    if (fact) {
      facts.push(fact);
    }
  }

  const deduplicated = deduplicateFacts(facts);
  console.log(`[Xweather Fetcher] Storm reports: ${deduplicated.length} facts (from ${reports.length} reports)`);

  return deduplicated;
}

// ============================================================================
// ALERT FACTS
// ============================================================================

function getAlertType(alert: XweatherAlert): XweatherFactType {
  const type = alert.details?.type?.toLowerCase() || '';
  const name = alert.details?.name?.toLowerCase() || '';

  if (type.includes('tornado') || name.includes('tornado')) return 'tornado_report';
  if (type.includes('flood') || name.includes('flood')) return 'flood_report';
  if (type.includes('winter') || name.includes('winter') || name.includes('snow') || name.includes('ice') || name.includes('blizzard')) return 'winter_event';
  if (type.includes('fire') || name.includes('fire') || name.includes('red flag')) return 'fire_event';
  if (type.includes('hurricane') || type.includes('tropical')) return 'tropical_event';
  if (type.includes('wind') || name.includes('wind')) return 'reported_wind';
  if (type.includes('heat') || name.includes('heat')) return 'measured_temp';

  return 'alert';
}

function alertToFact(alert: XweatherAlert): XweatherFact | null {
  if (!alert.details || !alert.place || !alert.timestamps) {
    return null;
  }

  const stateAbbrev = alert.place.state || '';
  const stateName = getStateName(stateAbbrev);
  const timestamp = alert.timestamps.issuedISO || new Date(alert.timestamps.issued * 1000).toISOString();
  const factType = getAlertType(alert);

  const fact: XweatherFact = {
    fact_id: generateFactId('alert', alert.id || alert.details.type, alert.loc?.lat || 0),
    type: factType,
    value: null,
    units: null,
    location: {
      name: alert.place.name || 'Unknown',
      state: stateName,
      state_abbrev: stateAbbrev,
      lat: alert.loc?.lat || 0,
      lon: alert.loc?.long || 0,
    },
    timestamp_utc: timestamp,
    confidence: 'forecast',
    source_name: 'Xweather',
    source_url: `https://www.xweather.com/alerts`,
    alert_type: alert.details.name || alert.details.type,
    severity: alert.severity,
    raw_data: alert.details.body?.substring(0, 200) || alert.details.name,
  };

  const validation = validateFact(fact);
  if (!validation.valid) {
    console.log(`[Xweather Fetcher] Alert rejected: ${validation.reason}`);
    return null;
  }

  return fact;
}

export async function fetchAlertFacts(): Promise<XweatherFact[]> {
  console.log('[Xweather Fetcher] Fetching alert facts...');

  const alerts = await fetchAlerts();
  const facts: XweatherFact[] = [];

  // Prioritize high-impact alerts
  const priorityTypes = [
    'tornado', 'hurricane', 'flood', 'blizzard', 'ice storm',
    'severe thunderstorm', 'winter storm', 'fire', 'extreme'
  ];

  const prioritizedAlerts = alerts.sort((a, b) => {
    const aType = a.details?.name?.toLowerCase() || '';
    const bType = b.details?.name?.toLowerCase() || '';

    const aPriority = priorityTypes.findIndex(t => aType.includes(t));
    const bPriority = priorityTypes.findIndex(t => bType.includes(t));

    // Higher priority (lower index) comes first
    if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
    if (aPriority !== -1) return -1;
    if (bPriority !== -1) return 1;
    return 0;
  });

  // Limit to most significant alerts
  for (const alert of prioritizedAlerts.slice(0, 100)) {
    const fact = alertToFact(alert);
    if (fact) {
      facts.push(fact);
    }
  }

  const deduplicated = deduplicateFacts(facts);
  console.log(`[Xweather Fetcher] Alerts: ${deduplicated.length} facts (from ${alerts.length} alerts)`);

  return deduplicated;
}

// ============================================================================
// FACTS BUNDLE BUILDER
// ============================================================================

export async function buildXweatherFactsBundle(): Promise<XweatherFactsBundle> {
  console.log('[Xweather Fetcher] Building facts bundle...');
  const startTime = Date.now();

  // Fetch all sources in parallel
  const [observationFacts, stormReportFacts, alertFacts] = await Promise.all([
    fetchObservationFacts(),
    fetchStormReportFacts(6), // Last 6 hours
    fetchAlertFacts(),
  ]);

  // Combine all facts
  const allFacts = [...observationFacts, ...stormReportFacts, ...alertFacts];

  // Final deduplication across all sources
  const deduplicated = deduplicateFacts(allFacts);

  // Create fact_ids Set for validation lookup
  const factIds = new Set(deduplicated.map(f => f.fact_id));

  const bundle: XweatherFactsBundle = {
    generated_at: new Date().toISOString(),
    facts: deduplicated,
    fact_ids: factIds,
    counts: {
      observations: observationFacts.length,
      storm_reports: stormReportFacts.length,
      alerts: alertFacts.length,
      total: deduplicated.length,
    },
    validation: {
      total_fetched: allFacts.length,
      passed: deduplicated.length,
      rejected: allFacts.length - deduplicated.length,
      rejection_reasons: [],
    },
  };

  const elapsed = Date.now() - startTime;
  console.log(`[Xweather Fetcher] Bundle complete in ${elapsed}ms:`);
  console.log(`  - Observations: ${observationFacts.length}`);
  console.log(`  - Storm Reports: ${stormReportFacts.length}`);
  console.log(`  - Alerts: ${alertFacts.length}`);
  console.log(`  - Total (deduplicated): ${deduplicated.length}`);

  return bundle;
}
