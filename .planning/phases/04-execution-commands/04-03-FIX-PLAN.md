---
phase: 04-execution-commands
plan: 03-FIX
type: fix
---

<objective>
Fix 1 UAT issue from plan 04-03: /new-project does not initialize git repository.

Source: 04-03-ISSUES.md
Priority: 1 blocker, 0 major, 0 minor

Without git initialization, the entire 04-03 git commit integration feature is unusable for new projects.
</objective>

<execution_context>
Execute tasks sequentially. The fix is in the /new-project command (Phase 3), not /execute-plan.
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md

**Issues being fixed:**
@.planning/phases/04-execution-commands/04-03-ISSUES.md

**Original plan for reference:**
@.planning/phases/04-execution-commands/04-03-PLAN.md

**File to modify:**
@src/chat/commands/newProject.ts

**Git service for reference (from 04-03):**
@src/chat/executor/gitService.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix UAT-001 - Add git init to /new-project</name>
  <files>src/chat/commands/newProject.ts</files>
  <action>
Modify the /new-project command to initialize a git repository after creating the project:

1. Import child_process utilities:
   - `import { exec } from 'child_process'`
   - `import { promisify } from 'util'`
   - Create: `const execAsync = promisify(exec)`

2. After creating PROJECT.md successfully (after `saveProject()` call), add git initialization:

   ```typescript
   // Initialize git repository for new projects
   const workspacePath = workspaceFolders[0].uri.fsPath;
   try {
     // Check if git repo already exists
     await execAsync('git rev-parse --git-dir', { cwd: workspacePath });
     // Git already initialized - skip
   } catch {
     // No git repo exists - initialize one
     stream.progress('Initializing git repository...');
     try {
       await execAsync('git init', { cwd: workspacePath });
       await execAsync('git add .planning/', { cwd: workspacePath });
       await execAsync('git commit -m "chore: initialize project with Hopper"', { cwd: workspacePath });
       stream.markdown('✓ Git repository initialized with initial commit\n\n');
     } catch (gitError) {
       // Git not available or error - warn but continue
       const errorMsg = gitError instanceof Error ? gitError.message : String(gitError);
       stream.markdown(`⚠️ Could not initialize git: ${errorMsg}\n\n`);
       stream.markdown('*Git commit integration will be unavailable. Install git and run `git init` manually.*\n\n');
     }
   }
   ```

3. This should be placed after the success message for PROJECT.md creation but before showing "Next Steps".

4. The flow should be:
   - Create .planning/ directory with PROJECT.md
   - Check if git exists
   - If no git: init, stage .planning/, commit
   - If git exists: skip (user may have existing repo)
   - Continue to show success and next steps

5. Handle edge cases:
   - Git command not found → warn, continue without git
   - Permission errors → warn, continue
   - Already a git repo → do nothing, success

Avoid: Don't use gitService.ts from executor - it expects an existing repo. Use direct exec here since this is a one-time initialization.
  </action>
  <verify>
- npm run compile succeeds
- Create new test project with /new-project
- Check that .git directory exists
- Check git log shows initial commit
  </verify>
  <done>
- /new-project initializes git repo when none exists
- Initial commit includes .planning/ directory
- Graceful handling when git unavailable
- No change if git repo already exists
- UAT-001 resolved
  </done>
</task>

</tasks>

<verification>
Before declaring plan complete:
- [ ] npm run compile succeeds without errors
- [ ] /new-project creates git repo in new workspaces
- [ ] Initial commit has message "chore: initialize project with Hopper"
- [ ] Existing git repos not affected
- [ ] Graceful failure when git not installed
</verification>

<success_criteria>
- UAT-001 from 04-03-ISSUES.md addressed
- Git initialization works on new projects
- Ready for re-verification with /gsd:verify-work
</success_criteria>

<output>
After completion, create `.planning/phases/04-execution-commands/04-03-FIX-SUMMARY.md`

After execution, update 04-03-ISSUES.md:
- Move UAT-001 to "Resolved Issues" section
- Add resolution date and commit hash
</output>
