# Phase 2: Chat Participant - Research

**Researched:** 2026-01-13
**Domain:** VSCode Chat Participants API
**Confidence:** HIGH

<research_summary>
## Summary

Researched the VSCode Chat Participants API for building a @specflow chat participant with slash command routing. The API is now finalized and stable (since VSCode 1.104+). The standard approach uses `vscode.chat.createChatParticipant()` with a `ChatRequestHandler` that streams responses via `ChatResponseStream`.

Key finding: VSCode provides rich stream methods beyond plain markdown - buttons, file trees, references, and progress indicators are built-in. Don't hand-roll these UI patterns. The optional `@vscode/chat-extension-utils` library can simplify tool calling and prompt management, but is not required for basic participants.

**Primary recommendation:** Implement manually using the Chat Participants API directly (no utility library needed for our scope), leverage built-in stream methods for rich UI, and carefully handle conversation history via `context.history` for multi-turn context awareness.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vscode | ^1.104.0 | Extension API | Required for Chat Participants API (finalized) |
| TypeScript | ^5.6.3 | Language | Already established in Phase 1 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @vscode/chat-extension-utils | latest | Prompt crafting, tool calling loops | Only if implementing tool calling with LLM |
| @vscode/prompt-tsx | latest | JSX-based prompt templates | Complex multi-component prompts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual handler | chat-extension-utils | Utils simplify tool calling but add dependency; manual is simpler for our use case |
| Inline prompts | prompt-tsx | TSX templates for complex prompts, but overkill for GSD-style prompts |

**Installation:**
```bash
# Core - already in package.json
npm install  # No new dependencies needed

# Optional (if tool calling needed later)
npm install @vscode/chat-extension-utils
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
src/
├── chat/
│   ├── specflowParticipant.ts    # Participant registration + handler
│   ├── commands/                  # Slash command implementations
│   │   ├── index.ts              # Command router
│   │   ├── progressCommand.ts    # /progress implementation
│   │   ├── planPhaseCommand.ts   # /plan-phase stub (Phase 3)
│   │   └── ...
│   └── context/                   # Context injection helpers
│       ├── planningContext.ts    # Load .planning/ files
│       └── historyContext.ts     # Format conversation history
├── extension.ts                   # Activation + registration
└── ...
```

### Pattern 1: ChatRequestHandler with Command Routing
**What:** Single handler that checks `request.command` and delegates to command-specific logic
**When to use:** Always - this is the standard pattern for slash commands
**Example:**
```typescript
// Source: VSCode Chat Participants API docs
const handler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<IChatResult> => {
  // Route based on command
  if (request.command === 'progress') {
    return handleProgressCommand(request, context, stream, token);
  }
  if (request.command === 'plan-phase') {
    return handlePlanPhaseCommand(request, context, stream, token);
  }
  // Default: natural language interaction
  return handleChat(request, context, stream, token);
};
```

### Pattern 2: Streaming Response with Progress
**What:** Use `stream.progress()` before long operations, then `stream.markdown()` for content
**When to use:** Any operation taking >500ms
**Example:**
```typescript
// Source: VSCode Chat Participant tutorial
stream.progress('Loading project context...');

const projectContext = await loadPlanningContext();
const messages = [
  vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
  vscode.LanguageModelChatMessage.User(projectContext),
  vscode.LanguageModelChatMessage.User(request.prompt)
];

const response = await request.model.sendRequest(messages, {}, token);

for await (const fragment of response.text) {
  if (token.isCancellationRequested) {
    break;
  }
  stream.markdown(fragment);
}
```

### Pattern 3: Conversation History for Multi-turn Context
**What:** Access previous turns via `context.history` to maintain conversation coherence
**When to use:** When user follow-ups reference earlier messages ("now do X with that")
**Example:**
```typescript
// Source: VSCode Chat Participant tutorial
const previousMessages = context.history.filter(
  h => h instanceof vscode.ChatResponseTurn
);

const historyContext = previousMessages.map(m => {
  let fullMessage = '';
  m.response.forEach(r => {
    const mdPart = r as vscode.ChatResponseMarkdownPart;
    fullMessage += mdPart.value.value;
  });
  return vscode.LanguageModelChatMessage.Assistant(fullMessage);
});
```

### Pattern 4: Follow-up Provider for Suggested Actions
**What:** Suggest next commands/questions after a response
**When to use:** After every response to guide user workflow
**Example:**
```typescript
// Source: VSCode Chat Participants API docs
participant.followupProvider = {
  provideFollowups(
    result: IChatResult,
    context: vscode.ChatContext,
    token: vscode.CancellationToken
  ): vscode.ChatFollowup[] {
    if (result.metadata?.lastCommand === 'discuss-phase') {
      return [
        { prompt: '/plan-phase', label: 'Plan this phase' },
        { prompt: '/research-phase', label: 'Research before planning' }
      ];
    }
    return [];
  }
};
```

### Anti-Patterns to Avoid
- **Not checking cancellation token:** Always check `token.isCancellationRequested` in loops
- **Ignoring conversation history:** Leads to repetitive/disconnected responses
- **Throwing raw errors to stream:** Catch `LanguageModelError` and show friendly messages
- **One participant per command:** VSCode discourages multiple participants; use slash commands instead
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Progress indicators | Custom spinner text | `stream.progress(msg)` | Native UI, consistent with VSCode |
| Clickable file links | Markdown links | `stream.reference(uri)` | Opens in editor, shows in references panel |
| Action buttons | Custom markdown links | `stream.button({ command, title })` | Executes VSCode commands, proper styling |
| File tree preview | ASCII tree | `stream.filetree(tree, base)` | Interactive preview, proper file icons |
| Symbol links | `file.ts:123` text | `stream.anchor(uri, name)` | Jump-to-definition behavior |
| Command links | `[text](command:id)` + trust handling | `stream.button()` | Safer, no trust/escaping issues |

**Key insight:** The ChatResponseStream API provides all the UI primitives needed for a rich chat experience. Building custom versions creates inconsistent UX and misses built-in accessibility features.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Not Handling Cancellation
**What goes wrong:** User cancels but stream continues, wasting resources
**Why it happens:** Forgetting to pass/check cancellation token in async loops
**How to avoid:** Check `token.isCancellationRequested` before each `stream.markdown()` call
**Warning signs:** Responses continue appearing after user stops them

### Pitfall 2: LanguageModelError Not Caught
**What goes wrong:** Uncaught error crashes handler, user sees generic error
**Why it happens:** Model requests can fail (no consent, quota, offline)
**How to avoid:** Wrap `sendRequest` in try-catch, check for `vscode.LanguageModelError`
**Warning signs:** "Something went wrong" instead of "Model unavailable - check connection"

### Pitfall 3: Package.json ID Mismatch
**What goes wrong:** Participant doesn't register or commands don't route
**Why it happens:** ID in `createChatParticipant()` differs from `chatParticipants` contribution
**How to avoid:** Use exact same ID string: `specflow.chat-participant` everywhere
**Warning signs:** @specflow doesn't appear in chat, commands silently fail

### Pitfall 4: Ignoring Context History Limits
**What goes wrong:** Token limit exceeded with long conversations
**Why it happens:** Including full history in every request
**How to avoid:** Summarize or truncate old history; prioritize recent messages
**Warning signs:** "Request too large" errors after ~10 turns

### Pitfall 5: Markdown Command Links Without Trust
**What goes wrong:** Links like `[Run](/command:myCmd)` don't work
**Why it happens:** VSCode blocks untrusted command links for security
**How to avoid:** Use `stream.button()` instead, or set `isTrusted` with explicit command list
**Warning signs:** Clickable links that do nothing when clicked

### Pitfall 6: Multiple Participants
**What goes wrong:** Confusing UX, unclear which participant to use
**Why it happens:** Creating separate participant for each "feature"
**How to avoid:** One participant with slash commands for different modes
**Warning signs:** @specflow-plan, @specflow-execute, etc. appearing separately
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources:

### Package.json Contribution
```json
// Source: VSCode Chat Participants API docs
"contributes": {
  "chatParticipants": [
    {
      "id": "specflow.chat-participant",
      "name": "specflow",
      "fullName": "SpecFlow",
      "description": "Model-agnostic structured planning for agent chat",
      "isSticky": true,
      "commands": [
        {
          "name": "progress",
          "description": "Check project progress and route to next action"
        },
        {
          "name": "plan-phase",
          "description": "Create detailed plan for a phase"
        }
      ]
    }
  ]
}
```

### Complete Handler with Error Handling
```typescript
// Source: VSCode extension samples + docs
import * as vscode from 'vscode';

interface ISpecflowResult extends vscode.ChatResult {
  metadata?: {
    lastCommand?: string;
    phaseNumber?: number;
  };
}

const handler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<ISpecflowResult> => {
  try {
    // Check license for Phase 2+ features
    // (injected via closure or module export)

    // Route to command handlers
    if (request.command) {
      return await routeCommand(request, context, stream, token);
    }

    // Default: forward to model with context
    stream.progress('Processing your request...');

    const messages = [
      vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT),
      vscode.LanguageModelChatMessage.User(request.prompt)
    ];

    const response = await request.model.sendRequest(messages, {}, token);

    for await (const fragment of response.text) {
      if (token.isCancellationRequested) {
        break;
      }
      stream.markdown(fragment);
    }

    return { metadata: { lastCommand: undefined } };

  } catch (err) {
    if (err instanceof vscode.LanguageModelError) {
      stream.markdown(`**Error:** ${err.message}\n\nPlease check your model connection.`);
      return { metadata: { lastCommand: 'error' } };
    }
    throw err;
  }
};
```

### Participant Creation with Follow-ups
```typescript
// Source: VSCode Chat Participants API docs
export function createSpecflowParticipant(
  context: vscode.ExtensionContext,
  licenseValidator: LicenseValidator
): vscode.ChatParticipant {
  const participant = vscode.chat.createChatParticipant(
    'specflow.chat-participant',
    handler
  );

  participant.iconPath = vscode.Uri.joinPath(
    context.extensionUri,
    'resources',
    'icon.png'
  );

  participant.followupProvider = {
    provideFollowups(result, context, token) {
      // Suggest next actions based on last command
      return [
        { prompt: 'What should I do next?', label: 'Get guidance' },
        { prompt: '/progress', label: 'Check progress' }
      ];
    }
  };

  return participant;
}
```

### Rich Stream Response
```typescript
// Source: VSCode Chat Participants API docs
async function showProjectStatus(
  stream: vscode.ChatResponseStream,
  workspaceUri: vscode.Uri
): Promise<void> {
  // Progress indicator
  stream.progress('Analyzing project...');

  // Markdown content
  stream.markdown('## Project Status\n\n');
  stream.markdown('Current phase: **2 - Chat Participant**\n\n');

  // File reference (clickable)
  const stateUri = vscode.Uri.joinPath(workspaceUri, '.planning', 'STATE.md');
  stream.reference(stateUri);

  // Action button
  stream.button({
    command: 'specflow.planPhase',
    title: 'Plan Next Phase',
    arguments: [3]
  });

  // File tree preview
  stream.filetree(
    [{ name: '.planning', children: [
      { name: 'PROJECT.md' },
      { name: 'ROADMAP.md' },
      { name: 'STATE.md' }
    ]}],
    workspaceUri
  );
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

What's changed recently:

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Proposed API | Finalized API | VSCode 1.104 | API is stable, can publish to marketplace |
| chatParticipants proposal | Standard contribution | 2024 | No `enableProposedApi` needed |
| Manual tool loops | chat-extension-utils | 2024 | Optional library for complex tool calling |

**New tools/patterns to consider:**
- **Disambiguation**: Auto-routing without explicit @mention via `disambiguation` property
- **Agent mode tools**: New `LanguageModelTool` API for structured tool calling (Phase 4+)
- **Result metadata**: Store data in `ChatResult.metadata` for multi-turn state

**Deprecated/outdated:**
- **chatParticipantPrivate proposal**: Now standard API, remove proposal usage
- **System messages in prompts**: Use User messages for system instructions (System not supported)
</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved:

1. **Model-agnostic prompting**
   - What we know: `request.model` provides the user-selected model
   - What's unclear: How to handle NEAR AI models vs Copilot models differently (if needed)
   - Recommendation: Start model-agnostic; add model-specific handling only if issues arise

2. **Token budget management**
   - What we know: chat-extension-utils handles token budgets automatically
   - What's unclear: Exact limits for different models via NEAR AI provider
   - Recommendation: Implement basic history truncation; refine based on real usage

3. **Offline/disconnected behavior**
   - What we know: `LanguageModelError` indicates model unavailable
   - What's unclear: Best UX for NEAR AI API being down vs no model selected
   - Recommendation: Show specific error messages; offer fallback suggestions
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [VSCode Chat Participants API Guide](https://code.visualstudio.com/api/extension-guides/ai/chat) - Registration, handlers, streaming, commands
- [VSCode Chat Tutorial](https://code.visualstudio.com/api/extension-guides/ai/chat-tutorial) - Complete implementation walkthrough
- [VSCode Language Model API](https://code.visualstudio.com/api/extension-guides/ai/language-model) - Model requests, error handling

### Secondary (MEDIUM confidence)
- [VSCode Extension Samples - chat-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-sample) - Reference implementation patterns
- [vscode-chat-extension-utils](https://github.com/microsoft/vscode-chat-extension-utils) - Optional library documentation

### Tertiary (LOW confidence - needs validation)
- None - all findings verified against official documentation
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: VSCode Chat Participants API (vscode ^1.104.0)
- Ecosystem: ChatResponseStream, ChatContext, follow-up providers
- Patterns: Command routing, streaming, history handling, error catching
- Pitfalls: Cancellation, ID mismatch, trust issues, history limits

**Confidence breakdown:**
- Standard stack: HIGH - verified with official VSCode docs
- Architecture: HIGH - patterns from official tutorial + samples
- Pitfalls: HIGH - documented in official guides, verified in samples
- Code examples: HIGH - adapted from official VSCode sources

**Research date:** 2026-01-13
**Valid until:** 2026-02-13 (30 days - VSCode API stable)
</metadata>

---

*Phase: 02-chat-participant*
*Research completed: 2026-01-13*
*Ready for planning: yes*
