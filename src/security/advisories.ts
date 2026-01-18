/**
 * GitHub Advisory Database client with caching
 *
 * Provides real-time threat intelligence by fetching security advisories
 * from GitHub's public Advisory Database API. Implements 24-hour caching
 * to reduce API calls and support offline scanning.
 */

import * as vscode from 'vscode';
import {
  GitHubAdvisory,
  AdvisoryCache,
  AdvisoryFetchResult,
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
