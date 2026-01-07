/**
 * Headlines Module
 *
 * Exports all headlines-related functionality.
 *
 * The verified system uses:
 * - verified-fetchers.ts: Produces VerifiedFact objects with validation
 * - verified-generator.ts: Generates headlines with strict fact references
 */

export * from './types';
export * from './storage';

// New verified system (primary)
export * from './verified-fetchers';
export * from './verified-generator';

// Legacy modules are kept but not exported from index to avoid name collisions
// Import directly from specific files if needed:
// - ./fetchers (deprecated)
// - ./generator (deprecated)
// - ./lsr-fetcher (deprecated)
// - ./station-obs-fetcher (deprecated)
// - ./storm-events-fetcher (deprecated)
// - ./facts-normalizer (deprecated)
