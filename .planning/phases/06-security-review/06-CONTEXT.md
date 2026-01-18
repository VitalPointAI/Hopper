# Phase 6: Security Review - Context

**Gathered:** 2026-01-18
**Status:** Ready for planning

<vision>
## How This Should Work

This is NOT an internal security audit of the extension itself — it's a `/security-check` command that users run on THEIR projects.

When a user runs `/security-check`, Hopper analyzes their codebase for security vulnerabilities, then operates in two modes:
1. **Auto-hardening** — automatically fixes common, safe-to-fix vulnerabilities (like XSS, SQL injection patterns)
2. **Interactive fixing** — for anything requiring judgment, presents the issue and offers to fix it with user approval

The experience should feel like having a security expert review your code: thorough, educational, and actionable.

</vision>

<essential>
## What Must Be Nailed

- **Catch real threats** — Must find actual vulnerabilities, not just style nits. Quality over quantity.
- **Fix without breaking** — Auto-fixes must be safe. Never introduce bugs while hardening.
- **Clear explanations** — User understands WHY something is a risk and what the fix does.

All three are equally critical. A security tool that misses real issues, breaks code, or leaves users confused has failed.

</essential>

<boundaries>
## What's Out of Scope

- **Dependency audits** — Don't scan node_modules or third-party packages. npm audit already handles that. Focus on the user's own code.
- No compliance report generation (SOC2, HIPAA, PCI) — just find and fix vulnerabilities

</boundaries>

<specifics>
## Specific Ideas

- **Severity levels** — Categorize findings as critical/high/medium/low like professional security scanners
- **OWASP categories** — Organize findings by OWASP Top 10 (injection, XSS, broken auth, sensitive data exposure, etc.)
- **Quick summary first** — Show count of issues found by severity, then let user drill into details

Presentation flow: Summary → Category breakdown → Individual findings → Fix options

</specifics>

<notes>
## Additional Context

This command transforms Hopper from a planning/execution tool into something that actively improves code quality. It's about eliminating threats and hardening against malintent in the user's project.

The hybrid auto-fix + interactive approach balances efficiency (fix obvious things) with safety (get approval for judgment calls).

</notes>

---

*Phase: 06-security-review*
*Context gathered: 2026-01-18*
