# Phase 1: Foundation - Research

**Researched:** 2026-01-12
**Domain:** VSCode Extension Development with Custom Language Model Provider + NEAR AI Integration
**Confidence:** HIGH

<research_summary>
## Summary

Researched the VSCode extension ecosystem for building a custom Language Model provider that integrates NEAR AI models into VSCode's native model picker. The key discovery is that VSCode v1.104+ introduced the **Language Model Chat Provider API** which allows extensions to register custom model providers that appear alongside Copilot models in the model picker.

The standard approach uses:
1. VSCode's `LanguageModelChatProvider` interface to register models
2. NEAR AI's OpenAI-compatible API (`https://api.near.ai/v1`) for inference
3. Standard VSCode extension scaffolding via Yeoman generator

**Critical constraint discovered:** Models provided through the Language Model Chat Provider API are currently only available to users on individual GitHub Copilot plans (Free, Pro, Pro+). This is a platform limitation that affects all custom model providers.

**Primary recommendation:** Use the LanguageModelChatProvider API (v1.104+) with NEAR AI's OpenAI-compatible endpoint. Structure the extension to translate between VSCode's chat message format and OpenAI's format, handle streaming responses via the progress callback.
</research_summary>

<standard_stack>
## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @types/vscode | ^1.104.0 | VSCode API types | Required for Language Model Chat Provider API |
| typescript | ^5.x | Type-safe development | Standard for VSCode extensions |
| openai | ^4.x | OpenAI-compatible client | NEAR AI uses OpenAI-compatible API |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @vscode/test-cli | latest | Extension testing | Test runner for VSCode extensions |
| @vscode/test-electron | latest | Extension testing | E2E testing in VSCode environment |
| esbuild | ^0.21.x | Bundling | Faster builds than webpack, recommended by VSCode |
| eslint | ^9.x | Linting | Code quality |
| @stylistic/eslint-plugin | latest | Style linting | Consistent code style |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| openai SDK | Raw fetch | openai SDK handles streaming, retries, types automatically |
| esbuild | webpack | webpack more mature but slower; esbuild recommended for new extensions |
| TypeScript | JavaScript | TypeScript strongly recommended for VSCode API type safety |

**Installation:**
```bash
npm install openai
npm install -D @types/vscode typescript esbuild eslint @vscode/test-cli @vscode/test-electron
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```
specflow/
├── .vscode/
│   ├── launch.json        # Debug configurations
│   └── tasks.json         # Build tasks
├── src/
│   ├── extension.ts       # Activation, provider registration
│   ├── provider/
│   │   ├── nearAiProvider.ts    # LanguageModelChatProvider implementation
│   │   └── modelInfo.ts         # Model metadata definitions
│   ├── client/
│   │   └── nearAiClient.ts      # NEAR AI API client wrapper
│   ├── auth/
│   │   └── nearAuth.ts          # NEAR authentication handling
│   └── utils/
│       ├── messageConverter.ts  # VSCode <-> OpenAI message conversion
│       └── tokenCounter.ts      # Token estimation
├── package.json           # Extension manifest with contributions
├── tsconfig.json          # TypeScript config
└── esbuild.js             # Build script
```

### Pattern 1: Language Model Chat Provider Registration
**What:** Register a custom provider that exposes NEAR AI models to VSCode
**When to use:** Extension activation
**Example:**
```typescript
// src/extension.ts
import * as vscode from 'vscode';
import { NearAiChatModelProvider } from './provider/nearAiProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new NearAiChatModelProvider(context);

  const disposable = vscode.lm.registerLanguageModelChatProvider(
    'near-ai',  // Must match vendor in package.json
    provider
  );

  context.subscriptions.push(disposable);
}
```

### Pattern 2: LanguageModelChatProvider Interface Implementation
**What:** Implement the three required methods for model provision
**When to use:** Core provider logic
**Example:**
```typescript
// src/provider/nearAiProvider.ts
import * as vscode from 'vscode';

export class NearAiChatModelProvider implements vscode.LanguageModelChatProvider {

  async provideLanguageModelChatInformation(
    options: { silent: boolean },
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    // Return available NEAR AI models
    return [{
      id: 'near-ai.qwen-72b',
      name: 'Qwen 72B',
      family: 'qwen',
      version: '2.5',
      maxInputTokens: 32768,
      maxOutputTokens: 8192,
      capabilities: {
        toolCalling: true,
        imageInput: false
      }
    }];
  }

  async provideLanguageModelChatResponse(
    model: vscode.LanguageModelChatInformation,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    // Convert messages, call NEAR AI, stream response via progress
    const convertedMessages = this.convertMessages(messages);

    const stream = await this.client.chat.completions.create({
      model: this.mapModelId(model.id),
      messages: convertedMessages,
      stream: true
    });

    for await (const chunk of stream) {
      if (token.isCancellationRequested) break;
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        progress.report(new vscode.LanguageModelTextPart(content));
      }
    }
  }

  async provideTokenCount(
    model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatRequestMessage,
    token: vscode.CancellationToken
  ): Promise<number> {
    // Estimate tokens (can use tiktoken or simple heuristic)
    const str = typeof text === 'string' ? text : this.messageToString(text);
    return Math.ceil(str.length / 4); // Rough estimate
  }
}
```

### Pattern 3: NEAR AI Client Setup with OpenAI SDK
**What:** Configure OpenAI client for NEAR AI's compatible endpoint
**When to use:** API client initialization
**Example:**
```typescript
// src/client/nearAiClient.ts
import OpenAI from 'openai';

export function createNearAiClient(authSignature: string): OpenAI {
  return new OpenAI({
    baseURL: 'https://api.near.ai/v1',
    apiKey: authSignature,  // JSON-encoded auth object
    defaultHeaders: {
      'Content-Type': 'application/json'
    }
  });
}
```

### Pattern 4: package.json Contribution Points
**What:** Register the provider and management command in manifest
**When to use:** Extension configuration
**Example:**
```json
{
  "contributes": {
    "languageModelChatProviders": [
      {
        "vendor": "near-ai",
        "displayName": "NEAR AI",
        "managementCommand": "specflow.manageNearAi"
      }
    ],
    "commands": [
      {
        "command": "specflow.manageNearAi",
        "title": "Manage NEAR AI Models"
      }
    ]
  },
  "engines": {
    "vscode": "^1.104.0"
  }
}
```

### Anti-Patterns to Avoid
- **Not handling cancellation:** Always check `token.isCancellationRequested` in streaming loops
- **Blocking activation:** Don't do async work synchronously in activate(); register providers immediately
- **Missing error handling:** Wrap API calls in try/catch, surface errors via `vscode.window.showErrorMessage`
- **Hardcoded auth:** Never store API keys in code; use VSCode SecretStorage or config files
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OpenAI API client | Custom fetch wrapper | `openai` npm package | Handles streaming, retries, types, edge cases |
| Extension scaffolding | Manual setup | `yo code` generator | Correct structure, launch.json, tasks.json |
| Message streaming | Manual chunking | Progress callback + for-await | VSCode API handles UI updates |
| Token counting | Custom tokenizer | Heuristic or `tiktoken` | Exact counting rarely needed, estimates suffice |
| Secret storage | Custom encryption | `context.secrets` API | VSCode's secure storage is battle-tested |
| Build bundling | Custom scripts | esbuild config | Community-standard, handles tree-shaking |

**Key insight:** VSCode extension development has established patterns for nearly everything. The Language Model Chat Provider API is new (v1.104) but follows VSCode's standard provider pattern. The main innovation is in connecting NEAR AI's OpenAI-compatible API to this interface - the boilerplate is handled by standard tools.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Copilot Plan Requirement
**What goes wrong:** Extension works in development but users can't see models
**Why it happens:** Language Model Chat Provider API requires GitHub Copilot subscription (Free/Pro/Pro+)
**How to avoid:** Document requirement clearly; consider fallback UI for users without Copilot
**Warning signs:** Models appear in Extension Development Host but not production

### Pitfall 2: Missing package.json Contribution
**What goes wrong:** Provider registers but models don't appear in picker
**Why it happens:** Forgot `contributes.languageModelChatProviders` in package.json
**How to avoid:** Always define provider in both package.json AND extension.ts registration
**Warning signs:** No errors but provider doesn't show up

### Pitfall 3: VSCode Version Incompatibility
**What goes wrong:** API methods undefined, extension fails to activate
**Why it happens:** Language Model Chat Provider API requires VSCode 1.104+
**How to avoid:** Set `"engines": { "vscode": "^1.104.0" }` in package.json
**Warning signs:** `vscode.lm.registerLanguageModelChatProvider is not a function`

### Pitfall 4: Streaming Response Handling
**What goes wrong:** Responses appear all at once instead of streaming
**Why it happens:** Not using for-await with streaming API, or buffering before reporting
**How to avoid:** Report each chunk immediately via `progress.report()`
**Warning signs:** Long delay then full response appears

### Pitfall 5: NEAR AI Authentication Format
**What goes wrong:** 401/403 errors from NEAR AI API
**Why it happens:** Auth signature must be JSON-stringified auth object, not just API key
**How to avoid:** Read `~/.nearai/config.json` and pass `JSON.stringify(auth)` as API key
**Warning signs:** Authentication errors despite valid config

### Pitfall 6: Token Cancellation Ignored
**What goes wrong:** Streaming continues after user cancels, wasting API calls
**Why it happens:** Not checking `token.isCancellationRequested` in stream loop
**How to avoid:** Check cancellation token on each chunk; abort controller for fetch
**Warning signs:** API usage higher than expected, responses after cancel

### Pitfall 7: LanguageModelError Not Thrown
**What goes wrong:** Can't distinguish error types in catch block
**Why it happens:** Known VSCode bug - error isn't instanceof LanguageModelError
**How to avoid:** Check error.code property directly instead of instanceof check
**Warning signs:** Error handling doesn't work as documented
</common_pitfalls>

<code_examples>
## Code Examples

Verified patterns from official sources:

### Extension Activation with Provider Registration
```typescript
// Source: VSCode Language Model Chat Provider API docs
import * as vscode from 'vscode';
import { NearAiChatModelProvider } from './provider/nearAiProvider';

export function activate(context: vscode.ExtensionContext) {
  // Register the provider - vendor must match package.json
  const disposable = vscode.lm.registerLanguageModelChatProvider(
    'near-ai',
    new NearAiChatModelProvider(context)
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}
```

### Model Information Response
```typescript
// Source: VSCode API docs - LanguageModelChatInformation interface
const modelInfo: vscode.LanguageModelChatInformation = {
  id: 'near-ai.fireworks-qwen-72b',
  name: 'Qwen 2.5 72B Instruct',
  family: 'qwen',
  version: '2.5',
  maxInputTokens: 32768,
  maxOutputTokens: 8192,
  tooltip: 'High-performance open model via NEAR AI',
  detail: 'Fireworks-hosted Qwen model',
  capabilities: {
    toolCalling: true,
    imageInput: false
  }
};
```

### Message Conversion (VSCode -> OpenAI Format)
```typescript
// Source: Chat Model Provider Sample
private convertMessages(
  messages: readonly vscode.LanguageModelChatRequestMessage[]
): Array<{ role: string; content: string }> {
  return messages.map(msg => ({
    role: msg.role === vscode.LanguageModelChatMessageRole.User
      ? 'user'
      : 'assistant',
    content: msg.content
      .filter(part => part instanceof vscode.LanguageModelTextPart)
      .map(part => (part as vscode.LanguageModelTextPart).value)
      .join('')
  }));
}
```

### Streaming Response Implementation
```typescript
// Source: OpenAI SDK + VSCode provider pattern
async provideLanguageModelChatResponse(
  model: vscode.LanguageModelChatInformation,
  messages: readonly vscode.LanguageModelChatRequestMessage[],
  options: vscode.ProvideLanguageModelChatResponseOptions,
  progress: vscode.Progress<vscode.LanguageModelResponsePart>,
  token: vscode.CancellationToken
): Promise<void> {
  const convertedMessages = this.convertMessages(messages);

  try {
    const stream = await this.client.chat.completions.create({
      model: 'fireworks::accounts/fireworks/models/qwen2p5-72b-instruct',
      messages: convertedMessages,
      stream: true
    });

    for await (const chunk of stream) {
      if (token.isCancellationRequested) {
        stream.controller.abort();
        break;
      }

      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        progress.report(new vscode.LanguageModelTextPart(content));
      }
    }
  } catch (error) {
    // Surface error to user
    throw new Error(`NEAR AI request failed: ${error.message}`);
  }
}
```

### NEAR AI Client Configuration
```typescript
// Source: NEAR AI docs - OpenAI-compatible endpoint
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export function createNearAiClient(): OpenAI {
  // Read auth from ~/.nearai/config.json
  const configPath = path.join(os.homedir(), '.nearai', 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const authSignature = JSON.stringify(config.auth);

  return new OpenAI({
    baseURL: 'https://api.near.ai/v1',
    apiKey: authSignature
  });
}
```

### Package.json Configuration
```json
// Source: VSCode Extension docs + chat-model-provider-sample
{
  "name": "specflow",
  "displayName": "SpecFlow",
  "version": "0.0.1",
  "engines": {
    "vscode": "^1.104.0"
  },
  "categories": ["AI", "Chat"],
  "activationEvents": [],
  "main": "./dist/extension.js",
  "contributes": {
    "languageModelChatProviders": [
      {
        "vendor": "near-ai",
        "displayName": "NEAR AI",
        "managementCommand": "specflow.manageNearAi"
      }
    ],
    "commands": [
      {
        "command": "specflow.manageNearAi",
        "title": "Manage NEAR AI Connection",
        "category": "SpecFlow"
      }
    ]
  },
  "scripts": {
    "compile": "esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node",
    "watch": "npm run compile -- --watch",
    "package": "vsce package"
  }
}
```
</code_examples>

<sota_updates>
## State of the Art (2025-2026)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Copilot-only models | Language Model Chat Provider API | VSCode 1.104 (Oct 2025) | Extensions can now register custom model providers |
| Manual BYOK settings | Extension-based providers | VSCode 1.104+ | Better UX, more control |
| Inline chat only | Chat participants + tools | VSCode 1.90+ | Full chat integration |
| REST API only | vscode.lm namespace | VSCode 1.90+ | First-class API support |

**New tools/patterns to consider:**
- **@vscode/chat-extension-utils**: Simplifies chat participant implementation with built-in tool calling loop
- **LanguageModelToolCallPart**: New in latest VSCode for tool calling responses
- **Prompt TSX library**: For complex prompt composition with token budget management

**Deprecated/outdated:**
- **chatProvider (proposed API)**: Replaced by `LanguageModelChatProvider` (stable)
- **Manual model picker**: Use `languageModelChatProviders` contribution point instead
- **nearai Agent Framework**: Deprecated (shutdown Oct 2025), use cloud.near.ai instead
</sota_updates>

<open_questions>
## Open Questions

Things that couldn't be fully resolved:

1. **NEAR AI Model Catalog**
   - What we know: Uses `provider::model-path` format (e.g., `fireworks::accounts/fireworks/models/qwen2p5-72b-instruct`)
   - What's unclear: Complete list of available models and their capabilities
   - Recommendation: Implement model listing via `client.models.list()` at runtime; hardcode known models initially

2. **Tool Calling Support**
   - What we know: VSCode API supports tool calling via `LanguageModelToolCallPart`
   - What's unclear: Whether NEAR AI's OpenAI-compatible endpoint supports function calling
   - Recommendation: Start without tool calling; add if NEAR AI confirms support

3. **Authentication UX**
   - What we know: Auth requires NEAR wallet signature stored in `~/.nearai/config.json`
   - What's unclear: Best UX for users who haven't used nearai CLI
   - Recommendation: Provide setup wizard command; link to nearai CLI for initial auth

4. **Copilot Plan Workaround**
   - What we know: Language Model providers require Copilot subscription
   - What's unclear: Whether there's a way to use models without Copilot plan
   - Recommendation: Research alternative approaches (direct chat participant without LM API) for Phase 2
</open_questions>

<sources>
## Sources

### Primary (HIGH confidence)
- [VSCode Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider) - Official docs for custom model registration
- [VSCode Chat Extension API](https://code.visualstudio.com/api/extension-guides/ai/chat) - Chat participant registration
- [chat-model-provider-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/chat-model-provider-sample) - Official sample implementation
- [VSCode Extension Generator](https://github.com/microsoft/vscode-generator-code) - Official scaffolding tool

### Secondary (MEDIUM confidence)
- [NEAR AI Inference docs](https://docs.near.ai/) - OpenAI-compatible API (docs structure is incomplete)
- [Bring Your Own Key Blog](https://code.visualstudio.com/blogs/2025/10/22/bring-your-own-key) - Context on model provider ecosystem
- WebSearch results on NEAR AI API format - Verified against multiple sources

### Tertiary (LOW confidence - needs validation)
- NEAR AI model list - Needs runtime verification via API
- Tool calling support in NEAR AI - Requires testing
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: VSCode Extension API, Language Model Chat Provider API
- Ecosystem: VSCode 1.104+, OpenAI SDK, NEAR AI Cloud
- Patterns: Provider registration, streaming responses, message conversion
- Pitfalls: Copilot requirement, version compatibility, auth format

**Confidence breakdown:**
- Standard stack: HIGH - verified with official VSCode docs and samples
- Architecture: HIGH - based on official sample code and API docs
- Pitfalls: MEDIUM - some from GitHub issues, some from docs
- Code examples: HIGH - adapted from official sources

**Research date:** 2026-01-12
**Valid until:** 2026-02-12 (30 days - VSCode API is stable but NEAR AI is in beta)
</metadata>

---

*Phase: 01-foundation*
*Research completed: 2026-01-12*
*Ready for planning: yes*
