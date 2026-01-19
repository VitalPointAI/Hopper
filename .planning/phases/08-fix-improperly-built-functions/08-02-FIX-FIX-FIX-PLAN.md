---
phase: 08-fix-improperly-built-functions
plan: 02-FIX-FIX-FIX
type: fix
---

<objective>
Fix 1 UAT blocker issue from plan 08-02-FIX-FIX.

Source: 08-02-FIX-FIX-ISSUES.md
Priority: 1 blocker, 0 major, 1 cosmetic (cosmetic deferred - VSCode API limitation)

Purpose: Restore wallet license checking by correcting the contract name mismatch introduced during the rebrand.
Output: Working license validation for wallet users.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/08-fix-improperly-built-functions/08-02-FIX-FIX-ISSUES.md

**Original plan for reference:**
@.planning/phases/08-fix-improperly-built-functions/08-02-FIX-FIX-PLAN.md

**Affected file:**
@src/licensing/types.ts
</context>

<tasks>

<task type="auto">
  <name>Fix UAT-001: Correct license contract name</name>
  <files>src/licensing/types.ts</files>
  <action>
Update the DEFAULT_LICENSE_CONFIG.contractId from 'license.hopper.near' to 'license.specflow.near'.

The contract was deployed as license.specflow.near during Phase 1.5.1 but the rebrand in Phase 1.5.3 incorrectly updated this default value. The actual NEAR contract was never redeployed with the new name.

Change line ~62:
```typescript
// Before
contractId: 'license.hopper.near',

// After
contractId: 'license.specflow.near',
```

This is a one-line fix in the DEFAULT_LICENSE_CONFIG object.
  </action>
  <verify>
1. Build succeeds: npm run compile
2. Extension loads without errors
3. Manual test: Connect wallet, run /plan-phase 1 - should check license without "Server error"
  </verify>
  <done>License checks query the correct contract (license.specflow.near) and wallet users can have licenses validated.</done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] Contract name changed to license.specflow.near
- [ ] npm run compile succeeds
- [ ] No TypeScript errors
</verification>

<success_criteria>
- UAT-001 (blocker) fixed - license checks work for wallet users
- UAT-002 (cosmetic) documented as VSCode API limitation - buttons are rendered vertically by design, not fixable without custom webview
</success_criteria>

<output>
After completion, create `.planning/phases/08-fix-improperly-built-functions/08-02-FIX-FIX-FIX-SUMMARY.md`
</output>
