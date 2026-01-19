---
phase: 09-useability-and-skills
plan: 02-FIX-FIX-FIX
type: fix
---

<objective>
Fix 1 UAT issue from plan 09-02-FIX-FIX.

Source: 09-02-FIX-FIX-ISSUES.md
Priority: 0 blocker, 1 major, 0 minor

**Issue:** Plan Fix button passes simplified plan identifier (e.g., "09-02") instead of full identifier with FIX suffixes (e.g., "09-02-FIX-FIX"), causing findIssuesFile to look for wrong file.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/09-useability-and-skills/09-02-FIX-FIX-ISSUES.md

**Original plan for reference:**
@.planning/phases/09-useability-and-skills/09-02-FIX-FIX-PLAN.md

**Implementation file:**
@src/chat/commands/executePlan.ts
@src/chat/commands/planFix.ts
</context>

<tasks>

<task type="auto">
  <name>Fix UAT-001: Pass full plan identifier to Plan Fix button</name>
  <files>src/chat/commands/executePlan.ts, src/chat/commands/planFix.ts</files>
  <action>
Two changes are needed:

1. In executePlan.ts (around line 1700-1710):
   - Currently constructs planIdentifier as `{phaseNum}-{planNum}` using parseInt which strips FIX suffixes
   - Change to use the full `plan.planNumber` from frontmatter OR parse the full plan value
   - Actually, planNumber is already parseInt'd. Need to store the raw frontmatter plan value
   - Better approach: Pass the full plan value from frontmatter (e.g., "02-FIX-FIX")
   - Construct as `{phaseNum}-{frontmatter.plan}` (e.g., "09-02-FIX-FIX")

2. In planFix.ts findIssuesFile function (around line 77-130):
   - Currently only matches `{phase}-{plan}-ISSUES.md` with numeric plan
   - Update regex to handle plan names with FIX suffixes
   - Change planMatch regex from `/^(\d+(?:\.\d+)?)-(\d+)/` to `/^(\d+(?:\.\d+)?)-(.+)/`
   - This allows plan to be "02", "02-FIX", "02-FIX-FIX", etc.
   - Update issuesFileName construction to use the full plan name, not padded numeric

Implementation details:

For executePlan.ts:
- The ExecutionPlan type needs to include the raw plan string from frontmatter
- In planParser.ts, store `frontmatter.plan` as a string property (planName or similar)
- In executePlan.ts, use this planName for the Plan Fix button argument

For planFix.ts:
- Line 82: Change regex to `/^(\d+(?:\.\d+)?)-(.+)/` to capture full plan name
- Line 106: Change issuesFileName to use the captured plan name directly
- Line 110-113: Update matching logic to compare full plan names

Actually, simpler fix:
- Just need to change executePlan.ts to pass the full plan identifier
- planFix.ts already has logic to search for files ending in -ISSUES.md
- The issue is the planIdentifier doesn't include FIX suffixes

In executePlan.ts at line 1702-1704:
```typescript
// Old:
const phaseNum = plan.phase.match(/^(\d+)/)?.[1] || '00';
const planNum = String(plan.planNumber).padStart(2, '0');
const planIdentifier = `${phaseNum}-${planNum}`;

// New approach - need to get the raw plan value from frontmatter
// This requires adding rawPlan to ExecutionPlan type
```

Simpler: Get plan identifier from the plan file path itself, or add rawPlan to the parser.

Add `rawPlan: string` to ExecutionPlan type in types.ts
Populate it in planParser.ts from frontmatter.plan
Use it in executePlan.ts for the Plan Fix button
  </action>
  <verify>
1. Build the extension: npm run compile
2. Execute a FIX plan (e.g., 09-02-FIX-FIX-PLAN.md) that has failures
3. Click the "Plan Fix" button
4. Verify it finds and parses the correct ISSUES.md file (09-02-FIX-FIX-ISSUES.md)
  </verify>
  <done>Plan Fix button correctly finds phase-scoped ISSUES.md files for plans with FIX suffixes</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] Extension compiles without errors
- [ ] Plan Fix button passes full plan identifier with FIX suffixes
- [ ] findIssuesFile locates correct ISSUES.md file
- [ ] Original UAT-001 acceptance criteria met
</verification>

<success_criteria>
- UAT-001 from 09-02-FIX-FIX-ISSUES.md addressed
- Plan Fix button works for plans with FIX suffixes
- Ready for re-verification
</success_criteria>

<output>
After completion, create `.planning/phases/09-useability-and-skills/09-02-FIX-FIX-FIX-SUMMARY.md`
</output>
