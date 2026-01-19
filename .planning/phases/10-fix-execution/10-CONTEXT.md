# Phase 10: Fix Execution - Context

**Gathered:** 2026-01-19
**Status:** Ready for planning

<vision>
## How This Should Work

When executing a plan with issues from an ISSUES.md file, the system should correctly identify which files were actually affected by the issue and modified during the fix. Currently, placeholder text like `[Identify affected files from the issue context]` is being passed through literally as a file path, causing git staging to fail with "pathspec did not match any files".

The execution should:
1. Parse issues correctly and determine actual affected files from context
2. Track which files were actually created/modified during task execution
3. Stage only real files that exist and were touched
4. Handle git failures gracefully without crashing the entire execution flow

</vision>

<essential>
## What Must Be Nailed

- **Fix the placeholder bug** - `[Identify affected files from the issue context]` must never be treated as an actual file path
- **Better file detection** - System should figure out which files were actually modified during execution, not rely on potentially-unresolved template text
- **Graceful git failures** - Git staging errors shouldn't crash the whole execution; warn and continue

</essential>

<boundaries>
## What's Out of Scope

- No specific exclusions — open to whatever makes sense during the fix
- Focus is on making execution work correctly, but changes to UI/UX or new features are acceptable if they emerge naturally from fixing the core issue

</boundaries>

<specifics>
## Specific Ideas

The specific error observed:
```
Files: [Identify affected files from the issue context]
...
*Git commit failed: Failed to stage files: fatal: pathspec '[Identify affected files from the issue context]' did not match any files*
```

This suggests:
1. The `Files:` field in FIX plans is being populated with placeholder text from the issue template
2. Git integration is trying to stage this literal string as a file path
3. The fallback/detection logic for affected files is not working

</specifics>

<notes>
## Additional Context

User encountered this during real testing of the extension on a separate project (specflow-test). The execution completed the task successfully (created PROJECT.md and 02-01-PLAN.md) but the git commit step failed because of the placeholder file path.

Priority is making the execution flow reliable and completing successfully, including the git integration step.

</notes>

---

*Phase: 10-fix-execution*
*Context gathered: 2026-01-19*
