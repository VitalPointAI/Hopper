/**
 * Security module for Hopper
 *
 * Provides security scanning capabilities including:
 * - Threat intelligence from GitHub Advisory Database
 * - Dependency vulnerability detection
 * - Type definitions for security issues
 *
 * Main entry point for security features.
 */

// Export all types
export {
  Severity,
  OWASPCategory,
  FixConfidence,
  SecurityIssue,
  GitHubAdvisory,
  DependencyIssue,
  AdvisoryCache,
  SecurityScanResult,
  AdvisoryFetchResult,
} from './types';

// Export advisory functions
export {
  fetchNpmAdvisories,
  getCachedAdvisories,
  getCacheAge,
  updateAdvisoryCache,
  getLatestAdvisories,
  clearAdvisoryCache,
  matchAdvisoriesToDependencies,
  readPackageJson,
} from './advisories';
