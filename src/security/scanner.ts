/**
 * ESLint-based security scanner
 *
 * Provides programmatic static analysis using ESLint with security plugins
 * to detect vulnerabilities like XSS, injection, and other OWASP issues.
 */

import { ESLint, Linter } from 'eslint';
import type { SecurityIssue, Severity, OWASPCategory, FixConfidence } from './types';

// Import plugins using require for CommonJS compatibility
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pluginSecurity = require('eslint-plugin-security');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pluginNoUnsanitized = require('eslint-plugin-no-unsanitized');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsParser = require('@typescript-eslint/parser');

/**
 * Severity mapping for ESLint rules
 * Maps rule IDs to our severity levels based on potential impact
 */
const RULE_SEVERITY: Record<string, Severity> = {
  // Critical (RCE potential)
  'security/detect-eval-with-expression': 'critical',
  'security/detect-child-process': 'critical',
  'security/detect-non-literal-require': 'high',

  // High (XSS, injection)
  'no-unsanitized/method': 'high',
  'no-unsanitized/property': 'high',

  // Medium
  'security/detect-non-literal-fs-filename': 'medium',
  'security/detect-pseudoRandomBytes': 'medium',
  'security/detect-disable-mustache-escape': 'medium',

  // Low
  'security/detect-possible-timing-attacks': 'low',
  'security/detect-buffer-noassert': 'low',
  'security/detect-no-csrf-before-method-override': 'low',
};

/**
 * OWASP Top 10:2025 mapping for ESLint rules
 */
const RULE_OWASP: Record<string, OWASPCategory> = {
  // Injection (A05)
  'security/detect-eval-with-expression': 'A05:2025-Injection',
  'security/detect-child-process': 'A05:2025-Injection',
  'security/detect-non-literal-require': 'A05:2025-Injection',
  'no-unsanitized/method': 'A05:2025-Injection',
  'no-unsanitized/property': 'A05:2025-Injection',

  // Cryptographic Failures (A04)
  'security/detect-pseudoRandomBytes': 'A04:2025-Cryptographic-Failures',

  // Broken Access Control (A01)
  'security/detect-non-literal-fs-filename': 'A01:2025-Broken-Access-Control',

  // Security Misconfiguration (A02)
  'security/detect-no-csrf-before-method-override': 'A02:2025-Security-Misconfiguration',
  'security/detect-disable-mustache-escape': 'A02:2025-Security-Misconfiguration',
};

/**
 * Fix confidence levels for ESLint rules
 * Determines whether an issue can be safely auto-fixed
 */
const FIX_CONFIDENCE: Record<string, FixConfidence> = {
  // HIGH - safe to auto-fix
  'security/detect-pseudoRandomBytes': 'high', // Math.random → crypto.randomBytes
  'security/detect-possible-timing-attacks': 'high', // === → crypto.timingSafeEqual

  // MEDIUM - may change behavior
  'no-unsanitized/property': 'medium', // innerHTML → DOMPurify.sanitize
  'no-unsanitized/method': 'medium',

  // LOW - needs context
  'security/detect-eval-with-expression': 'low',
  'security/detect-child-process': 'low',
  'security/detect-non-literal-require': 'low',
  'security/detect-non-literal-fs-filename': 'low',
};

/**
 * Returns ESLint flat config with security rules enabled
 */
function getSecurityConfig(): Linter.Config[] {
  return [
    {
      files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
      plugins: {
        security: pluginSecurity,
        'no-unsanitized': pluginNoUnsanitized,
      },
      languageOptions: {
        parser: tsParser,
        parserOptions: {
          ecmaVersion: 2022,
          sourceType: 'module',
        },
      },
      rules: {
        // XSS prevention (HIGH priority)
        'no-unsanitized/method': 'error',
        'no-unsanitized/property': 'error',

        // Injection prevention (CRITICAL priority)
        'security/detect-eval-with-expression': 'error',
        'security/detect-child-process': 'error',
        'security/detect-non-literal-require': 'error',
        'security/detect-non-literal-fs-filename': 'warn',

        // Cryptography (MEDIUM priority)
        'security/detect-pseudoRandomBytes': 'error',

        // Other security rules
        'security/detect-buffer-noassert': 'warn',
        'security/detect-possible-timing-attacks': 'warn',
        'security/detect-no-csrf-before-method-override': 'warn',
        'security/detect-disable-mustache-escape': 'error',

        // DISABLE noisy rules
        'security/detect-object-injection': 'off', // Too many false positives
        'security/detect-unsafe-regex': 'off', // Let regex-dos-detector handle
      },
    },
  ];
}

/**
 * Result from a security scan
 */
export interface ScanResult {
  /** Security issues found */
  issues: SecurityIssue[];
  /** Number of files scanned */
  filesScanned: number;
  /** Scan duration in milliseconds */
  duration: number;
}

/**
 * Scan files for security vulnerabilities using ESLint
 *
 * @param patterns - Glob patterns for files to scan (e.g., ['src/**\/*.ts'])
 * @param cwd - Working directory for the scan (defaults to process.cwd())
 * @returns Scan results with issues, file count, and duration
 */
export async function scanFiles(
  patterns: string[],
  cwd: string = process.cwd()
): Promise<ScanResult> {
  const startTime = Date.now();

  try {
    const eslint = new ESLint({
      cwd,
      overrideConfigFile: true,
      overrideConfig: getSecurityConfig(),
      // Don't scan node_modules
      ignore: true,
      // Prevent errors from stopping the scan
      errorOnUnmatchedPattern: false,
    });

    const results = await eslint.lintFiles(patterns);
    const issues: SecurityIssue[] = [];

    for (const result of results) {
      for (const message of result.messages) {
        // Skip if no rule ID (parse errors, etc.)
        if (!message.ruleId) {
          continue;
        }

        const ruleId = message.ruleId;
        const severity = RULE_SEVERITY[ruleId] || 'medium';
        const owasp = RULE_OWASP[ruleId];
        const fixConfidence = FIX_CONFIDENCE[ruleId];

        // Determine if fixable based on ESLint fix and our confidence
        const hasEslintFix = message.fix !== undefined;
        const isFixable = hasEslintFix && (fixConfidence === 'high' || fixConfidence === 'medium');

        const issue: SecurityIssue = {
          id: `eslint-${ruleId}-${result.filePath}-${message.line}-${message.column}`,
          type: 'code',
          file: result.filePath,
          line: message.line,
          column: message.column,
          ruleId,
          message: message.message,
          severity,
          owasp,
          fixable: isFixable,
          fixConfidence,
        };

        issues.push(issue);
      }
    }

    // Count files that were actually scanned (not skipped due to ignore)
    // The 'ignored' property exists at runtime but isn't in type definitions
    const filesScanned = results.filter((r) => !(r as { ignored?: boolean }).ignored).length;

    return {
      issues,
      filesScanned,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    // Never throw - return empty results on error
    console.error('[Hopper Security] ESLint scan error:', error);
    return {
      issues: [],
      filesScanned: 0,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Get the ESLint security configuration for inspection
 * Useful for debugging or understanding what rules are active
 */
export function getConfig(): Linter.Config[] {
  return getSecurityConfig();
}

/**
 * Get severity for a specific rule
 */
export function getRuleSeverity(ruleId: string): Severity {
  return RULE_SEVERITY[ruleId] || 'medium';
}

/**
 * Get OWASP category for a specific rule
 */
export function getRuleOwasp(ruleId: string): OWASPCategory | undefined {
  return RULE_OWASP[ruleId];
}
