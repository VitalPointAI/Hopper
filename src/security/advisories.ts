/**
 * GitHub Advisory Database client with caching
 *
 * Provides real-time threat intelligence by fetching security advisories
 * from GitHub's public Advisory Database API. Implements 24-hour caching
 * to reduce API calls and support offline scanning.
 */

import * as vscode from 'vscode';
import * as semver from 'semver';
import {
  GitHubAdvisory,
  AdvisoryCache,
  AdvisoryFetchResult,
  DependencyIssue,
  Severity,
} from './types';

/** Cache key for storing advisories in globalState */
const CACHE_KEY = 'hopper.security.advisoryCache';

/** Cache TTL: 24 hours in milliseconds */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** GitHub Advisory Database API endpoint */
const GITHUB_API_URL = 'https://api.github.com/advisories';

/**
 * Fetch npm advisories from GitHub Advisory Database
 *
 * Queries the public GitHub API for security advisories affecting npm packages.
 * No authentication required for public advisories.
 *
 * @returns Array of GitHubAdvisory objects
 * @throws Error if network request fails
 */
export async function fetchNpmAdvisories(): Promise<GitHubAdvisory[]> {
  const params = new URLSearchParams({
    ecosystem: 'npm',
    severity: 'critical,high,medium', // Skip low for noise reduction
    per_page: '100',
    sort: 'updated',
    direction: 'desc',
  });

  const response = await fetch(`${GITHUB_API_URL}?${params}`, {
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      // No auth required for public advisories
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const advisories = await response.json() as GitHubAdvisory[];
  return advisories;
}

/**
 * Get cached advisories from VSCode globalState
 *
 * Returns cached advisories if they exist and haven't expired.
 * Cache TTL is 24 hours.
 *
 * @param context - VSCode ExtensionContext for globalState access
 * @returns Cached advisories if fresh, null if expired or missing
 */
export function getCachedAdvisories(
  context: vscode.ExtensionContext
): GitHubAdvisory[] | null {
  const cached = context.globalState.get<AdvisoryCache>(CACHE_KEY);

  if (!cached) {
    return null;
  }

  const cacheAge = Date.now() - cached.timestamp;
  if (cacheAge >= CACHE_TTL_MS) {
    // Cache expired
    return null;
  }

  return cached.advisories;
}

/**
 * Get cache age in milliseconds
 *
 * Returns how long ago the cache was last updated.
 * Useful for displaying "last updated" information to users.
 *
 * @param context - VSCode ExtensionContext for globalState access
 * @returns Milliseconds since cache update, or -1 if no cache exists
 */
export function getCacheAge(context: vscode.ExtensionContext): number {
  const cached = context.globalState.get<AdvisoryCache>(CACHE_KEY);

  if (!cached) {
    return -1;
  }

  return Date.now() - cached.timestamp;
}

/**
 * Update advisory cache in globalState
 *
 * Saves advisories with current timestamp for cache expiry tracking.
 *
 * @param context - VSCode ExtensionContext for globalState access
 * @param advisories - Advisories to cache
 */
export async function updateAdvisoryCache(
  context: vscode.ExtensionContext,
  advisories: GitHubAdvisory[]
): Promise<void> {
  const cache: AdvisoryCache = {
    timestamp: Date.now(),
    advisories,
  };

  await context.globalState.update(CACHE_KEY, cache);
}

/**
 * Get latest advisories (main entry point)
 *
 * Fetches security advisories from GitHub Advisory Database with caching.
 * Returns cached data if fresh (< 24 hours), otherwise fetches new data.
 *
 * Handles errors gracefully:
 * - Network errors: Returns cached data if available, empty array if not
 * - API errors: Logs warning, returns cached data
 * - Never throws: Security scan should continue without advisories
 *
 * @param context - VSCode ExtensionContext for globalState access
 * @returns AdvisoryFetchResult with advisories and cache metadata
 */
export async function getLatestAdvisories(
  context: vscode.ExtensionContext
): Promise<AdvisoryFetchResult> {
  // Try cache first
  const cached = getCachedAdvisories(context);
  const cacheAge = getCacheAge(context);

  if (cached !== null) {
    // Cache hit - return cached data
    return {
      advisories: cached,
      fromCache: true,
      cacheAge: cacheAge,
    };
  }

  // Cache miss or expired - try to fetch fresh data
  try {
    const advisories = await fetchNpmAdvisories();

    // Update cache with fresh data
    await updateAdvisoryCache(context, advisories);

    return {
      advisories,
      fromCache: false,
      cacheAge: 0,
    };
  } catch (err) {
    // Network or API error - handle gracefully
    console.warn('[Hopper Security] Failed to fetch advisories:', err);

    // Try to return stale cached data if available
    const staleCache = context.globalState.get<AdvisoryCache>(CACHE_KEY);
    if (staleCache && staleCache.advisories.length > 0) {
      console.warn('[Hopper Security] Using stale cached advisories');
      return {
        advisories: staleCache.advisories,
        fromCache: true,
        cacheAge: Date.now() - staleCache.timestamp,
      };
    }

    // No cached data available - return empty
    console.warn('[Hopper Security] No cached advisories available');
    return {
      advisories: [],
      fromCache: false,
      cacheAge: -1,
    };
  }
}

/**
 * Clear advisory cache
 *
 * Removes cached advisories from globalState.
 * Useful for forcing a fresh fetch on next scan.
 *
 * @param context - VSCode ExtensionContext for globalState access
 */
export async function clearAdvisoryCache(
  context: vscode.ExtensionContext
): Promise<void> {
  await context.globalState.update(CACHE_KEY, undefined);
}

/**
 * Map GitHub advisory severity to internal Severity type
 */
function mapSeverity(ghSeverity: 'low' | 'medium' | 'high' | 'critical'): Severity {
  return ghSeverity; // Direct mapping - types align
}

/**
 * Check if an installed version is within a vulnerable range
 *
 * GitHub uses npm semver syntax for vulnerability ranges.
 * Examples: ">=1.0.0 <1.5.0", "<2.0.0", ">=3.0.0"
 *
 * @param installedVersion - Currently installed version (may include ^, ~, etc.)
 * @param vulnerableRange - Semver range of vulnerable versions
 * @returns true if installed version is vulnerable
 */
function isVulnerableVersion(
  installedVersion: string,
  vulnerableRange: string
): boolean {
  try {
    // Clean the installed version (remove ^, ~, etc.)
    const cleanVersion = semver.coerce(installedVersion);
    if (!cleanVersion) {
      // Cannot parse version - assume not vulnerable to avoid false positives
      return false;
    }

    // GitHub's vulnerable_version_range uses npm semver syntax
    // semver.satisfies checks if version is in the range
    return semver.satisfies(cleanVersion.version, vulnerableRange);
  } catch {
    // Semver parsing error - assume not vulnerable
    return false;
  }
}

/**
 * Match advisories to project dependencies
 *
 * Checks each advisory's vulnerable packages against installed dependencies.
 * Creates DependencyIssue objects for each match.
 *
 * @param advisories - Advisories from GitHub Advisory Database
 * @param dependencies - Project dependencies (name → version)
 * @returns Array of DependencyIssue for vulnerable packages
 */
export function matchAdvisoriesToDependencies(
  advisories: GitHubAdvisory[],
  dependencies: Record<string, string>
): DependencyIssue[] {
  const issues: DependencyIssue[] = [];

  for (const advisory of advisories) {
    for (const vuln of advisory.vulnerabilities) {
      // Only process npm ecosystem packages
      if (vuln.package.ecosystem !== 'npm') {
        continue;
      }

      const packageName = vuln.package.name;
      const installedVersion = dependencies[packageName];

      // Skip if package not in dependencies
      if (!installedVersion) {
        continue;
      }

      // Check if installed version is vulnerable
      if (!isVulnerableVersion(installedVersion, vuln.vulnerable_version_range)) {
        continue;
      }

      // Create DependencyIssue for this match
      const hasPatch = vuln.patched_versions !== null;
      const issue: DependencyIssue = {
        id: advisory.ghsa_id,
        type: 'dependency',
        ghsaId: advisory.ghsa_id,
        cveId: advisory.cve_id || undefined,
        package: packageName,
        installedVersion,
        vulnerableRange: vuln.vulnerable_version_range,
        patchedVersions: vuln.patched_versions || undefined,
        message: advisory.summary,
        severity: mapSeverity(advisory.severity),
        owasp: 'A03:2025-Supply-Chain-Failures', // All dependency issues map to supply chain
        cvssScore: advisory.cvss?.score,
        cwes: advisory.cwes.map((c) => c.cwe_id),
        fixable: hasPatch,
        fixConfidence: hasPatch ? 'high' : undefined,
        suggestedFix: hasPatch
          ? `Update ${packageName} to ${vuln.patched_versions}`
          : undefined,
      };

      issues.push(issue);
    }
  }

  return issues;
}

/**
 * Read package.json from workspace
 *
 * Extracts both dependencies and devDependencies.
 *
 * @param workspaceUri - Workspace root URI
 * @returns Merged dependencies map (name → version)
 */
export async function readPackageJson(
  workspaceUri: vscode.Uri
): Promise<Record<string, string>> {
  try {
    const packageJsonUri = vscode.Uri.joinPath(workspaceUri, 'package.json');
    const content = await vscode.workspace.fs.readFile(packageJsonUri);
    const packageJson = JSON.parse(Buffer.from(content).toString('utf-8'));

    const dependencies: Record<string, string> = {};

    // Merge dependencies
    if (packageJson.dependencies && typeof packageJson.dependencies === 'object') {
      Object.assign(dependencies, packageJson.dependencies);
    }

    // Merge devDependencies
    if (packageJson.devDependencies && typeof packageJson.devDependencies === 'object') {
      Object.assign(dependencies, packageJson.devDependencies);
    }

    return dependencies;
  } catch {
    // Failed to read or parse package.json
    return {};
  }
}
