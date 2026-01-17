# Summary: Phase 04 Plan 01-FIX8

**Completed:** 2026-01-17
**Duration:** 8 min
**Commit:** a2c8534

## Objective

Bypass buggy `copilot_createFile` tool by implementing custom Hopper file tools using VSCode's native workspace.fs API.

## What Was Done

### 1. Created Custom File Tools (`src/tools/fileTools.ts`)

New file implementing:
- `HopperCreateFileTool` - Creates files using `vscode.workspace.fs.writeFile`
- `HopperCreateDirectoryTool` - Creates directories using `vscode.workspace.fs.createDirectory`

Both tools:
- Accept absolute paths as input
- Validate input parameters
- Return structured `LanguageModelToolResult` with success/error messages
- Auto-create parent directories when needed

### 2. Registered Tools in package.json

Added `languageModelTools` contribution point:
```json
"languageModelTools": [
  {
    "name": "hopper_createFile",
    "inputSchema": { "filePath": string, "content": string }
  },
  {
    "name": "hopper_createDirectory",
    "inputSchema": { "dirPath": string }
  }
]
```

### 3. Registered Tools at Activation (`src/extension.ts`)

Added `registerFileTools(context)` call in activate function to register the custom tools with VSCode's Language Model Tools API.

### 4. Updated Prompt in `executePlan.ts`

Added explicit instructions for the model to prefer `hopper_*` tools over `copilot_*` tools:
```
**CRITICAL: Tool Selection**
For file operations, you MUST use the hopper_* tools (NOT copilot_* tools):
- Use hopper_createFile to create new files (with filePath and content)
- Use hopper_createDirectory to create directories (with dirPath)
```

## Root Cause

Bug in GitHub Copilot Chat extension 0.36.1 - the `copilot_createFile` tool throws "Invalid stream" error when invoked programmatically via `vscode.lm.invokeTool`. The error occurs inside the Copilot extension at `pfe.invoke`.

Notably, `copilot_createDirectory` works correctly - only `copilot_createFile` is affected.

## Solution

Implemented custom tools that use VSCode's native `workspace.fs` API which is reliable and well-documented. This bypasses the Copilot extension entirely for file operations.

## Files Changed

| File | Change |
|------|--------|
| src/tools/fileTools.ts | NEW - Custom file tool implementations |
| src/extension.ts | Import and register custom tools |
| package.json | Add languageModelTools contribution |
| src/chat/commands/executePlan.ts | Update prompt to prefer hopper_* tools |

## Verification

- [x] Build passes
- [x] Extension loads without errors
- [x] hopper_createFile successfully creates files
- [x] hopper_createDirectory successfully creates directories
- [x] Model uses hopper_* tools when instructed

## UAT Result

**Pass** - Files are now created successfully during plan execution.

---

*Phase: 04-execution-commands*
*Plan: 01-FIX8*
*Duration: 8 min*
