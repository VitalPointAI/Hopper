/**
 * Security scanning type definitions
 *
 * Provides comprehensive types for security vulnerability detection,
 * GitHub Advisory Database integration, and dependency scanning.
 */

/**
 * Severity levels aligned with CVSS v4.0
 *
 * - critical: CVSS 9.0-10.0 - Remote code execution, full system compromise
 * - high: CVSS 7.0-8.9 - XSS, SQL injection, significant data exposure
 * - medium: CVSS 4.0-6.9 - Path traversal, weak crypto, limited impact
 * - low: CVSS 0.1-3.9 - Timing attacks, minor information disclosure
 * - info: Informational findings, best practice recommendations
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * OWASP Top 10:2025 categories
 *
 * Updated from 2021 with new categories:
 * - A03: Supply Chain Failures (new)
 * - A10: Mishandling Exceptional Conditions (new)
 * - SSRF merged into A01 (Broken Access Control)
 */
export type OWASPCategory =
  | 'A01:2025-Broken-Access-Control'
  | 'A02:2025-Security-Misconfiguration'
  | 'A03:2025-Supply-Chain-Failures'
  | 'A04:2025-Cryptographic-Failures'
  | 'A05:2025-Injection'
  | 'A06:2025-Insecure-Design'
  | 'A07:2025-Authentication-Failures'
  | 'A08:2025-Software-Data-Integrity-Failures'
  | 'A09:2025-Security-Logging-Alerting-Failures'
  | 'A10:2025-Mishandling-Exceptional-Conditions';

/**
 * Fix confidence determines auto-fix eligibility
 *
 * - high: Pattern is unambiguous, fix is always correct (auto-fix eligible)
 * - medium: Fix may change behavior slightly, needs review
 * - low: Context-dependent, requires manual verification
 */
export type FixConfidence = 'high' | 'medium' | 'low';

/**
 * Core security issue interface
 *
 * Represents a vulnerability finding from static analysis or dependency scanning.
 * Used by both code-level analysis and dependency vulnerability detection.
 */
export interface SecurityIssue {
  /** Unique identifier for the issue (e.g., rule ID or GHSA ID) */
  id: string;

  /** Source of the issue - code analysis or dependency vulnerability */
  type: 'code' | 'dependency';

  /** File path where the issue was found (for code issues) */
  file?: string;

  /** Line number in the file (1-indexed) */
  line?: number;

  /** Column number in the line (1-indexed) */
  column?: number;

  /** ESLint or scanner rule ID that triggered this issue */
  ruleId?: string;

  /** Human-readable description of the vulnerability */
  message: string;

  /** Severity classification based on CVSS ranges */
  severity: Severity;

  /** OWASP Top 10:2025 category mapping */
  owasp?: OWASPCategory;

  /** CVSS v4.0 score (0.0-10.0) when available */
  cvssScore?: number;

  /** Whether an automatic fix is available */
  fixable: boolean;

  /** Confidence level for auto-fixing */
  fixConfidence?: FixConfidence;

  /** Suggested code fix or remediation guidance */
  suggestedFix?: string;
}

/**
 * GitHub Advisory structure
 *
 * Represents a security advisory from the GitHub Advisory Database.
 * These are fetched from api.github.com/advisories and cached locally.
 */
export interface GitHubAdvisory {
  /** GitHub Security Advisory ID (e.g., GHSA-xxxx-xxxx-xxxx) */
  ghsa_id: string;

  /** Common Vulnerabilities and Exposures ID (e.g., CVE-2025-12345) */
  cve_id: string | null;

  /** Brief summary of the vulnerability */
  summary: string;

  /** Detailed description of the vulnerability and its impact */
  description: string;

  /** Severity classification from GitHub */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** CVSS scoring information */
  cvss: {
    /** CVSS score (0.0-10.0) */
    score: number;
    /** CVSS vector string */
    vector_string: string;
  } | null;

  /** Common Weakness Enumeration entries */
  cwes: Array<{
    /** CWE identifier (e.g., CWE-79) */
    cwe_id: string;
    /** CWE name (e.g., "Cross-site Scripting") */
    name: string;
  }>;

  /** Affected packages and version ranges */
  vulnerabilities: Array<{
    /** Package ecosystem and name */
    package: {
      /** Package ecosystem (npm, pip, etc.) */
      ecosystem: string;
      /** Package name */
      name: string;
    };
    /** Semver range of vulnerable versions */
    vulnerable_version_range: string;
    /** Version(s) that fix the vulnerability, null if no fix available */
    patched_versions: string | null;
  }>;

  /** ISO 8601 timestamp when advisory was published */
  published_at: string;

  /** ISO 8601 timestamp when advisory was last updated */
  updated_at: string;
}

/**
 * Dependency issue from advisory matching
 *
 * Extends SecurityIssue with dependency-specific fields for
 * tracking vulnerable packages in the project's dependencies.
 */
export interface DependencyIssue extends SecurityIssue {
  /** Always 'dependency' for this type */
  type: 'dependency';

  /** GitHub Security Advisory ID */
  ghsaId: string;

  /** CVE ID if available */
  cveId?: string;

  /** Name of the affected package */
  package: string;

  /** Currently installed version */
  installedVersion: string;

  /** Semver range of vulnerable versions */
  vulnerableRange: string;

  /** Version to upgrade to for fix */
  patchedVersions?: string;

  /** CWE identifiers for categorization */
  cwes: string[];
}

/**
 * Advisory cache structure
 *
 * Stored in VSCode globalState with 24-hour TTL.
 * Enables offline scanning with cached threat intelligence.
 */
export interface AdvisoryCache {
  /** Unix timestamp (ms) when cache was last updated */
  timestamp: number;

  /** Cached advisories from GitHub Advisory Database */
  advisories: GitHubAdvisory[];
}

/**
 * Scan results
 *
 * Complete results from a security scan including both
 * code-level issues and dependency vulnerabilities.
 */
export interface SecurityScanResult {
  /** Issues found in source code via static analysis */
  codeIssues: SecurityIssue[];

  /** Vulnerable dependencies found via advisory matching */
  dependencyIssues: DependencyIssue[];

  /** Milliseconds since advisory cache was last updated */
  advisoryCacheAge: number;

  /** Number of source files scanned */
  scannedFiles: number;

  /** Total scan duration in milliseconds */
  scanDuration: number;
}

/**
 * Advisory fetch result
 *
 * Return type for the getLatestAdvisories function.
 */
export interface AdvisoryFetchResult {
  /** List of advisories (from cache or freshly fetched) */
  advisories: GitHubAdvisory[];

  /** Whether data came from cache */
  fromCache: boolean;

  /** Milliseconds since cache was last updated */
  cacheAge: number;
}
