/**
 * Xweather Headlines System
 *
 * Main exports for the Xweather-based headlines system.
 */

// Types
export * from './types';

// API Client
export {
  fetchObservations,
  fetchStationObservations,
  fetchStormReports,
  fetchAlerts,
  fetchAlertsByType,
  fetchThreats,
  checkXweatherHealth,
  clearCache,
} from './client';

// Fetchers
export {
  fetchObservationFacts,
  fetchStormReportFacts,
  fetchAlertFacts,
  buildXweatherFactsBundle,
} from './fetchers';

// Generator
export { generateXweatherHeadlines } from './generator';

// Storage
export {
  storeHeadlinesRun,
  getLatestRun,
  getRunHistory,
  needsNewRun,
  getTimeUntilNextRun,
  clearStorage,
  generatePlaceholderHeadlines,
} from './storage';
