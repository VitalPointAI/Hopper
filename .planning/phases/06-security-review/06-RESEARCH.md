# Phase 6: Security Review - Research

**Researched:** 2026-01-18
**Domain:** Static security analysis with auto-fix capabilities for JavaScript/TypeScript
**Confidence:** HIGH

<research_summary>
## Summary

Researched the ecosystem for building a `/security-check` command that scans user codebases for security vulnerabilities and provides both automated fixes and interactive remediation.

The standard approach uses **ESLint security plugins** for fast pattern detection (14-89 rules covering XSS, injection, eval, path traversal) combined with **jscodeshift** for safe AST-based code transformations. For comprehensive coverage, Semgrep provides 600+ high-confidence rules with OWASP/CWE references and cross-file taint analysis.

Key finding: Don't hand-roll vulnerability detection patterns. ESLint plugins like `eslint-plugin-security` and `eslint-plugin-no-unsanitized` cover known patterns that would take months to rediscover. Use DOMPurify for XSS sanitization fixes - it's OWASP-recommended and handles edge cases custom code would miss.

**Primary recommendation:** Use ESLint security plugins for detection (fast, integrates with VSCode), jscodeshift for safe auto-fixes, and the OWASP Top 10:2025 categorization for organizing findings. Implement a confidence threshold where only HIGH confidence issues get auto-fixed.
</research_summary>

<standard_stack>
## Standard Stack

### Core Detection
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| eslint | 9.x | Static analysis engine | Universal JS/TS analysis, plugin ecosystem |
| eslint-plugin-security | 3.x | Node.js security rules | 14 rules for common vulnerabilities, community-maintained |
| eslint-plugin-no-unsanitized | 4.x | DOM XSS detection | Mozilla-developed, proven in Firefox codebase |
| @typescript-eslint/parser | 8.x | TypeScript support | Enables ESLint to parse TypeScript |

### Enhanced Detection (Optional)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| eslint-plugin-xss | 0.1.x | XSS-specific rules | React/DOM-heavy codebases |
| eslint-plugin-secure-coding | 2.x | Extended ruleset | 89 rules, CWE/OWASP references, CVSS scores |
| semgrep | 1.x | Advanced SAST | Cross-file taint analysis, framework-aware rules |

### Safe Code Transformation
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jscodeshift | 17.x | AST-based codemods | Safe, formatting-preserving code transforms |
| recast | 0.23.x | AST printer | Preserves original code style (used by jscodeshift) |
| DOMPurify | 3.x | XSS sanitization | Adding sanitization to innerHTML calls |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ESLint plugins | Semgrep | Semgrep is more powerful but requires CLI installation, ESLint is already in most projects |
| jscodeshift | Babel transforms | jscodeshift preserves formatting better, purpose-built for codemods |
| Custom patterns | eslint-plugin-secure-coding | Secure-coding has 6x more rules but larger dependency |

**Installation:**
```bash
npm install --save-dev eslint-plugin-security eslint-plugin-no-unsanitized
npm install jscodeshift dompurify
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Component Structure
```
src/
├── security/
│   ├── types.ts              # SecurityIssue, Severity, OWASPCategory types
│   ├── scanner.ts            # Coordinates ESLint + custom detection
│   ├── rules/                # Custom ESLint rules if needed
│   ├── fixes/                # jscodeshift transforms by issue type
│   │   ├── xss-fix.ts
│   │   ├── injection-fix.ts
│   │   └── index.ts
│   ├── reporter.ts           # Format findings with severity/OWASP
│   └── index.ts
├── commands/
│   └── securityCheck.ts      # Command handler
```

### Pattern 1: Two-Phase Detection + Fix
**What:** Separate detection from remediation completely
**When to use:** Always - keeps concerns separate, enables dry-run
**Example:**
```typescript
// Phase 1: Detect (never modifies files)
const findings = await scanForVulnerabilities(workspaceUri);

// Phase 2: Categorize by fix confidence
const autoFixable = findings.filter(f => f.confidence === 'high');
const needsReview = findings.filter(f => f.confidence !== 'high');

// Phase 3: Apply safe fixes
for (const issue of autoFixable) {
  await applyFix(issue); // Uses jscodeshift
}

// Phase 4: Present remaining for user decision
await presentInteractiveFindings(needsReview);
```

### Pattern 2: ESLint API for Programmatic Scanning
**What:** Use ESLint's Node.js API instead of CLI
**When to use:** When you need to post-process results or customize reporting
**Example:**
```typescript
import { ESLint } from 'eslint';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: {
    plugins: ['security', 'no-unsanitized'],
    rules: {
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
    }
  }
});

const results = await eslint.lintFiles(['src/**/*.ts']);
// results contain line, column, message, ruleId for each issue
```

### Pattern 3: jscodeshift for Safe Transforms
**What:** AST-based code modification that preserves formatting
**When to use:** For auto-fixes - never use regex replacement
**Example:**
```typescript
import jscodeshift from 'jscodeshift';

// Transform: innerHTML = userInput → textContent = userInput
function fixInnerHTMLtoTextContent(source: string): string {
  const j = jscodeshift;
  const root = j(source);

  root.find(j.AssignmentExpression, {
    left: {
      type: 'MemberExpression',
      property: { name: 'innerHTML' }
    }
  })
  .forEach(path => {
    // Only fix if right side is simple variable (safe pattern)
    if (path.node.right.type === 'Identifier') {
      path.node.left.property.name = 'textContent';
    }
  });

  return root.toSource();
}
```

### Pattern 4: Confidence-Based Auto-Fix
**What:** Only auto-fix high-confidence, safe-to-fix issues
**When to use:** Always - prevents breaking code
**Example:**
```typescript
type FixConfidence = 'high' | 'medium' | 'low';

const autoFixRules: Record<string, FixConfidence> = {
  // HIGH: Pattern is unambiguous, fix is always correct
  'security/detect-eval-with-expression': 'low', // Can't auto-fix - needs context
  'no-unsanitized/property': 'medium', // innerHTML → textContent may change behavior

  // HIGH confidence auto-fixes:
  'detect-non-literal-regexp': 'high', // Escape user input
  'detect-possible-timing-attacks': 'high', // Use crypto.timingSafeEqual
};
```

### Anti-Patterns to Avoid
- **Regex-based code modification:** Use AST transforms - regex breaks on edge cases
- **Auto-fixing without confidence threshold:** Some fixes change behavior, require review
- **Scanning node_modules:** Wastes time, npm audit handles dependencies
- **Blocking on warnings:** Only block on critical/high severity to avoid alert fatigue
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| XSS detection patterns | Regex for innerHTML/eval | eslint-plugin-no-unsanitized | Mozilla reduced 1000s of grep results to 34 findings with this plugin |
| SQL injection detection | String matching for queries | eslint-plugin-security detect-non-literal-regexp | Edge cases like template literals, concatenation |
| HTML sanitization | Custom tag stripping | DOMPurify | OWASP-recommended, handles mutation XSS, SVG attacks |
| Timing attack detection | Manual equality checks | eslint-plugin-security detect-possible-timing-attacks | Covers all comparison operators |
| Code transformation | String.replace() | jscodeshift | Preserves formatting, handles AST edge cases |
| OWASP categorization | Manual mapping | Use CWE→OWASP mapping tables | Standards exist, don't reinvent |
| Severity scoring | Custom severity scale | CVSS score ranges | Industry standard: 0-3.9=Low, 4-6.9=Medium, 7-8.9=High, 9-10=Critical |

**Key insight:** Security pattern matching has decades of edge cases discovered by attackers. ESLint plugins encode this knowledge. Mozilla's eslint-plugin-no-unsanitized was battle-tested on Firefox's codebase. DOMPurify is maintained by Cure53 security researchers who specialize in XSS. Custom detection will miss attacks these tools catch.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: False Positive Fatigue
**What goes wrong:** Users ignore security findings because too many are noise
**Why it happens:** Default ESLint security rules flag patterns that may not be exploitable
**How to avoid:**
- Categorize findings by confidence (HIGH/MEDIUM/LOW)
- Only auto-fix HIGH confidence issues
- Show summary first (3 critical, 5 high, 12 medium) before details
- Allow users to dismiss false positives
**Warning signs:** Users stop running /security-check, or skip reviewing results

### Pitfall 2: Breaking Code with Auto-Fixes
**What goes wrong:** Auto-fix changes behavior, not just security
**Why it happens:** innerHTML → textContent loses HTML formatting intentionally set
**How to avoid:**
- Only auto-fix truly equivalent transformations
- For behavior-changing fixes, use interactive mode
- Always preserve original in git (don't stage auto-fixes automatically)
**Warning signs:** Tests fail after /security-check, users complain about "broken" features

### Pitfall 3: Missing Context-Dependent Vulnerabilities
**What goes wrong:** Scanner flags code that's actually safe due to context
**Why it happens:** Static analysis can't see runtime data flow
**How to avoid:**
- Mark issues as "potential" not "definite" when context unclear
- Check for sanitization in surrounding code before flagging
- Document which findings need manual verification
**Warning signs:** Findings say "may be vulnerable" without explaining what makes it safe

### Pitfall 4: Outdated OWASP/CWE Mappings
**What goes wrong:** Categories don't match current OWASP Top 10:2025
**Why it happens:** OWASP updated significantly in 2025 (new #3 Supply Chain, new #10 Exception Handling)
**How to avoid:**
- Use OWASP Top 10:2025 categories (not 2021)
- Map findings to A01-A10:2025 codes
- Note that SSRF moved into A01 (Broken Access Control)
**Warning signs:** "Vulnerable Components" instead of "Supply Chain Failures"

### Pitfall 5: Not Explaining the Risk
**What goes wrong:** User sees "XSS vulnerability" without understanding impact
**Why it happens:** Technical finding without business context
**How to avoid:**
- Include CVSS score for severity context
- Add one-line explanation: "Allows attackers to steal user sessions"
- Link to OWASP page for detailed explanation
**Warning signs:** Users ask "is this actually important?"
</common_pitfalls>

<code_examples>
## Code Examples

### ESLint Security Configuration
```typescript
// Source: eslint-plugin-security docs
import pluginSecurity from 'eslint-plugin-security';
import pluginNoUnsanitized from 'eslint-plugin-no-unsanitized';

export default [
  pluginSecurity.configs.recommended,
  {
    plugins: {
      'no-unsanitized': pluginNoUnsanitized
    },
    rules: {
      // XSS prevention
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',

      // Injection prevention
      'security/detect-eval-with-expression': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-child-process': 'warn',

      // Cryptography
      'security/detect-pseudoRandomBytes': 'error',

      // Turn off noisy rules
      'security/detect-object-injection': 'off', // Too many false positives
    }
  }
];
```

### Programmatic ESLint Scanning
```typescript
// Source: ESLint Node.js API docs
import { ESLint, Linter } from 'eslint';

async function scanFiles(patterns: string[]): Promise<SecurityIssue[]> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: getSecurityConfig(),
  });

  const results = await eslint.lintFiles(patterns);

  return results.flatMap(result =>
    result.messages.map(msg => ({
      file: result.filePath,
      line: msg.line,
      column: msg.column,
      severity: mapSeverity(msg.severity),
      ruleId: msg.ruleId,
      message: msg.message,
      owasp: mapToOWASP(msg.ruleId),
      fixable: msg.fix !== undefined,
    }))
  );
}
```

### Safe innerHTML Fix with jscodeshift
```typescript
// Source: jscodeshift patterns + DOMPurify docs
import jscodeshift, { API, FileInfo } from 'jscodeshift';

export default function transform(file: FileInfo, api: API) {
  const j = api.jscodeshift;
  const root = j(file.source);
  let modified = false;

  // Find: element.innerHTML = unsafeValue
  root.find(j.AssignmentExpression, {
    left: {
      type: 'MemberExpression',
      property: { name: 'innerHTML' }
    }
  })
  .forEach(path => {
    const right = path.node.right;

    // Only wrap if not already wrapped with DOMPurify
    if (right.type === 'CallExpression' &&
        right.callee.type === 'MemberExpression' &&
        right.callee.object.name === 'DOMPurify') {
      return; // Already sanitized
    }

    // Wrap with DOMPurify.sanitize()
    path.node.right = j.callExpression(
      j.memberExpression(
        j.identifier('DOMPurify'),
        j.identifier('sanitize')
      ),
      [right]
    );
    modified = true;
  });

  // Add import if we made changes
  if (modified) {
    const imports = root.find(j.ImportDeclaration);
    const hasDOMPurify = imports.some(
      p => p.node.source.value === 'dompurify'
    );

    if (!hasDOMPurify) {
      const newImport = j.importDeclaration(
        [j.importDefaultSpecifier(j.identifier('DOMPurify'))],
        j.literal('dompurify')
      );
      root.find(j.Program).get('body', 0).insertBefore(newImport);
    }
  }

  return modified ? root.toSource() : null;
}
```

### OWASP 2025 Category Mapping
```typescript
// Source: OWASP Top 10:2025 official list
type OWASPCategory =
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

const ruleToOWASP: Record<string, OWASPCategory> = {
  // Injection (A05)
  'security/detect-eval-with-expression': 'A05:2025-Injection',
  'security/detect-child-process': 'A05:2025-Injection',
  'security/detect-non-literal-regexp': 'A05:2025-Injection',
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
```

### Severity Classification
```typescript
// Source: CVSS v4.0 severity ranges
type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

function getSeverity(ruleId: string): Severity {
  const severityMap: Record<string, Severity> = {
    // Critical (CVSS 9.0-10.0): Remote code execution
    'security/detect-eval-with-expression': 'critical',
    'security/detect-child-process': 'critical',

    // High (CVSS 7.0-8.9): XSS, SQL injection potential
    'no-unsanitized/method': 'high',
    'no-unsanitized/property': 'high',
    'security/detect-non-literal-require': 'high',

    // Medium (CVSS 4.0-6.9): Path traversal, weak crypto
    'security/detect-non-literal-fs-filename': 'medium',
    'security/detect-pseudoRandomBytes': 'medium',

    // Low (CVSS 0.1-3.9): Timing attacks, buffer issues
    'security/detect-possible-timing-attacks': 'low',
    'security/detect-buffer-noassert': 'low',
  };

  return severityMap[ruleId] || 'medium';
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| OWASP Top 10:2021 | OWASP Top 10:2025 | Nov 2024 | New categories: Supply Chain (#3), Exception Handling (#10); SSRF merged into A01 |
| Manual security review | AI-assisted remediation | 2024-2025 | GitHub Copilot, Veracode Fix, Snyk Agent Fix can auto-generate fixes |
| ESLint 8 flat config | ESLint 9 native ESM | 2024 | New configuration format, plugin loading changes |
| Single-file analysis | Cross-file taint tracking | 2025 | Semgrep Code now traces data flow across JS/TS files together |
| CVSS v3.1 | CVSS v4.0 | Nov 2023 | New metric groups, refined severity calculations |

**New tools/patterns to consider:**
- **GitHub Copilot Code Scanning:** Can now assign security alerts to Copilot for automated remediation (Oct 2025)
- **Google CodeMender:** AI agent that proactively patches vulnerabilities (Dec 2025)
- **eslint-plugin-secure-coding:** 89 rules with CWE/OWASP references and CVSS scores built-in

**Deprecated/outdated:**
- **TSLint:** Fully deprecated, use ESLint with @typescript-eslint
- **OWASP Top 10:2017/2021:** Use 2025 version
- **Manual regex-based detection:** Use AST-aware tools
</sota_updates>

<open_questions>
## Open Questions

1. **LLM-assisted fix generation**
   - What we know: Tools like Veracode Fix and Copilot use LLMs to generate fixes
   - What's unclear: Whether generating fixes in-extension is better than pattern-based transforms
   - Recommendation: Start with deterministic jscodeshift transforms for v1; LLM fixes can be a later enhancement

2. **Semgrep integration complexity**
   - What we know: Semgrep has superior cross-file analysis but requires CLI installation
   - What's unclear: Whether adding Semgrep dependency is worth the complexity vs ESLint-only
   - Recommendation: ESLint-only for v1 (covers 80% of cases), Semgrep as optional enhancement

3. **Interactive fix UX in VSCode chat**
   - What we know: Chat API supports buttons but not complex multi-step flows
   - What's unclear: Best way to present 20+ findings with fix options
   - Recommendation: Summary first, then drill-down per-category, use vscode.window dialogs for fix approval
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/) - Official categories verified
- [eslint-plugin-security GitHub](https://github.com/eslint-community/eslint-plugin-security) - All 14 rules documented
- [jscodeshift GitHub](https://github.com/facebook/jscodeshift) - API and transform patterns
- [DOMPurify GitHub](https://github.com/cure53/DOMPurify) - XSS sanitization best practices

### Secondary (MEDIUM confidence)
- [Semgrep JavaScript docs](https://semgrep.dev/docs/languages/javascript) - Framework support verified with official docs
- [CVSS v4.0 Specification](https://www.first.org/cvss/specification-document) - Severity ranges confirmed
- [Mozilla XSS blog](https://blog.mozilla.org/attack-and-defense/2021/11/03/finding-and-fixing-dom-based-xss-with-static-analysis/) - eslint-plugin-no-unsanitized effectiveness verified

### Tertiary (LOW confidence - needs validation)
- eslint-plugin-secure-coding claims of 89 rules - not independently verified
- AI auto-fix tools (Copilot, Veracode Fix) - features announced but real-world effectiveness unclear
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: ESLint + security plugins for static analysis
- Ecosystem: jscodeshift for transforms, DOMPurify for sanitization
- Patterns: Two-phase detect/fix, confidence-based auto-fix, OWASP categorization
- Pitfalls: False positives, breaking fixes, outdated OWASP

**Confidence breakdown:**
- Standard stack: HIGH - verified with npm/GitHub docs
- Architecture: HIGH - based on established ESLint API patterns
- Pitfalls: HIGH - documented in tool README files and Mozilla blog
- Code examples: HIGH - derived from official documentation

**Research date:** 2026-01-18
**Valid until:** 2026-02-18 (30 days - security ecosystem changes frequently)
</metadata>

---

*Phase: 06-security-review*
*Research completed: 2026-01-18*
*Ready for planning: yes*
