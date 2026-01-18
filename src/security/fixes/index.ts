/**
 * Auto-fix transform infrastructure for security issues
 *
 * Uses jscodeshift for AST-based transforms that preserve code formatting.
 * Only high-confidence patterns are auto-fixed.
 */

import jscodeshift, { API, FileInfo, Transform } from 'jscodeshift';
import * as vscode from 'vscode';
import type { SecurityIssue, FixConfidence } from '../types';

/**
 * Result of applying a fix
 */
export interface FixResult {
  /** Path to the file that was processed */
  file: string;
  /** Whether the fix was successfully applied */
  applied: boolean;
  /** Description of what the fix does */
  description: string;
  /** First 200 chars of original code (for preview) */
  originalCode?: string;
  /** First 200 chars of fixed code (for preview) */
  fixedCode?: string;
  /** Error message if fix failed */
  error?: string;
}

/**
 * Transform registry entry
 */
export interface TransformEntry {
  /** jscodeshift transform function */
  transform: Transform;
  /** Human-readable description of what the transform does */
  description: string;
  /** Confidence level for auto-fixing */
  confidence: FixConfidence;
  /** Package that must be installed for the fix to work */
  requiresPackage?: string;
}

/**
 * Apply a jscodeshift transform to a file
 *
 * @param fileUri - VSCode URI of the file to transform
 * @param transform - jscodeshift transform function
 * @param description - Human-readable description of the fix
 * @returns Result indicating success/failure and before/after code
 */
export async function applyTransform(
  fileUri: vscode.Uri,
  transform: Transform,
  description: string
): Promise<FixResult> {
  try {
    // Read file content
    const content = await vscode.workspace.fs.readFile(fileUri);
    const source = Buffer.from(content).toString('utf-8');

    // Create jscodeshift API with TSX parser (supports both TS and TSX)
    const j = jscodeshift.withParser('tsx');

    // Create file info for transform
    const fileInfo: FileInfo = {
      path: fileUri.fsPath,
      source,
    };

    // Create API object
    const api: API = {
      jscodeshift: j,
      j,
      stats: () => {},
      report: () => {},
    };

    // Run transform - jscodeshift returns string | null | undefined | void
    const transformResult = transform(fileInfo, api, {});

    // Handle async transforms (unlikely but possible)
    const result =
      transformResult instanceof Promise ? await transformResult : transformResult;

    // If no changes (null/undefined/same source), return not applied
    if (!result || result === source) {
      return {
        file: fileUri.fsPath,
        applied: false,
        description,
        error: 'No changes needed',
      };
    }

    // Write transformed code back to file
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(result, 'utf-8'));

    return {
      file: fileUri.fsPath,
      applied: true,
      description,
      originalCode: source.slice(0, 200),
      fixedCode: result.slice(0, 200),
    };
  } catch (err) {
    return {
      file: fileUri.fsPath,
      applied: false,
      description,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Apply multiple fixes to a file in sequence
 *
 * Stops if a transform fails (not just "no changes").
 *
 * @param fileUri - VSCode URI of the file to transform
 * @param transforms - Array of transforms with descriptions
 * @returns Array of results for each transform attempted
 */
export async function applyFixes(
  fileUri: vscode.Uri,
  transforms: Array<{ transform: Transform; description: string }>
): Promise<FixResult[]> {
  const results: FixResult[] = [];

  for (const { transform, description } of transforms) {
    const result = await applyTransform(fileUri, transform, description);
    results.push(result);

    // If a transform failed (not just "no changes"), stop processing
    if (!result.applied && result.error && result.error !== 'No changes needed') {
      break;
    }
  }

  return results;
}

// Transform registry - maps rule IDs to transforms
// Will be populated by XSS and crypto transform modules
export const TRANSFORM_REGISTRY: Record<string, TransformEntry> = {};

/**
 * Get the fix transform for a security issue
 *
 * @param issue - Security issue to get fix for
 * @returns Transform entry if available, undefined if no fix exists
 */
export function getFixForIssue(
  issue: SecurityIssue
): TransformEntry | undefined {
  if (!issue.ruleId || !issue.fixable) {
    return undefined;
  }
  return TRANSFORM_REGISTRY[issue.ruleId];
}

/**
 * Register a transform in the registry
 *
 * Called by transform modules (xss.ts, crypto.ts) to register their transforms.
 */
export function registerTransform(ruleId: string, entry: TransformEntry): void {
  TRANSFORM_REGISTRY[ruleId] = entry;
}

// Import transform modules to trigger auto-registration
// These modules call registerTransform() when imported
import './xss';
import './crypto';

// Re-export transform modules for direct access
export * from './xss';
export * from './crypto';
