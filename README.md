# Hopper Velocity

**Stop losing track of complex projects. Turn ambitious ideas into shipped code.**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/VitalPoint.hopper-velocity?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=VitalPoint.hopper-velocity)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Transform How You Build

Ever started a project full of energy, only to lose momentum when complexity hits? Or juggled multiple features while context-switching destroys your flow? **Hopper Velocity gives you a persistent AI project manager inside VS Code** — one that never forgets where you left off, breaks down overwhelming tasks into clear steps, and keeps your entire team aligned.

### What You Can Do

🚀 **Launch confidently** — "I need to build a real-time chat feature with typing indicators" becomes a structured roadmap with research, implementation, and testing phases automatically planned.

⏸️ **Pick up instantly** — Close your laptop Friday, open it Monday. Hopper remembers exactly where you were, what you were working on, and what's next.

🎯 **Execute systematically** — Stop wondering "what should I work on now?" Hopper walks you through each step, tracks completions, and surfaces blockers before they derail you.

🔍 **Catch issues early** — Hopper surfaces its assumptions about your project. Review, correct, and align before writing a single line of code.

🔒 **Build with confidence** — Security analysis scans your codebase for vulnerabilities, validates dependencies, and ensures you're shipping trusted applications your users can rely on.

💰 **Keep your costs down** — Model-agnostic architecture means you control your AI spending. Bring your own API keys (OpenAI, Anthropic, etc.) or use NEAR AI. No forced expensive subscriptions.

🔐 **Privacy-first AI** — NEAR AI runs models in hardware-secured Trusted Execution Environments (Intel TDX, NVIDIA Confidential Computing). Your data stays encrypted and isolated — model providers can't see or train on your code. Verifiable private inference you can trust.

### See It In Action

```
You: @hopper /new-project
Hopper: Let's define your project...

You: Build a markdown blog with dark mode and RSS
Hopper: [Creates PROJECT.md with goals, success criteria, constraints]

You: @hopper /create-roadmap
Hopper: [Generates roadmap with phases: Setup, Core Blog, Dark Mode, RSS, Testing]

You: @hopper /plan-phase Setup
Hopper: [Creates detailed PLAN.md: install deps, configure, create structure...]

You: @hopper /execute-plan
Hopper: [Executes each step, commits changes, tracks progress]

--- Next day ---
You: @hopper /resume-work
Hopper: Resuming Phase 2: Core Blog, Step 3/12...
```

**Try the first phase free.** No credit card. No signup. Just install and build.

---

## Key Features

### 📋 Structured Planning That Scales
Break down any project into milestones and phases. Hopper creates executable plans with clear acceptance criteria, so you always know "what done looks like."

### 🤖 AI That Executes, Not Just Suggests  
Don't just get ideas — get implementations. Hopper writes code, runs commands, commits changes, and tracks what's complete vs. what's next.

### 💾 Sessions That Never Lose Context
Pause work anytime, resume from any device. Your project state, current step, and deferred issues travel with you.

### 🧪 Built-In Quality Gates
Discovery mode researches existing patterns before you build. UAT verification ensures features actually work before you ship.

### 🔐 Security-First Development
Automated security analysis identifies vulnerabilities, audits dependencies, and validates your code against best practices — ship trusted applications with confidence.

### 💸 Model-Agnostic & Cost-Effective
Not locked into one AI provider. Use NEAR AI, bring your own OpenAI/Anthropic keys, or switch anytime. Avoid forced $20-40/month subscriptions from tools like Cursor or GitHub Copilot Pro when you want pay-per-use control.

### 🛡️ Verifiable Privacy with NEAR AI
NEAR AI's cloud infrastructure runs models inside hardware-secured Trusted Execution Environments (TEEs) using Intel TDX and NVIDIA Confidential Computing. Your code and prompts are encrypted and isolated — model providers, cloud hosts, and NEAR AI itself cannot access your data. Every inference is verifiable. Perfect for sensitive codebases, enterprise compliance, or proprietary projects.

**Coming Soon:** Local AI inference support for fully offline development.

### 🎛️ Full Control, No Black Boxes
Every plan is editable. Every assumption is surfaced. You're always in the driver's seat — Hopper handles the navigation.

---

## Get Started in 60 Seconds

### Install
```bash
code --install-extension VitalPoint.hopper-velocity
```

Or: `Extensions` → Search `"Hopper Velocity"` → `Install`

> **Note:** Search for **"Hopper Velocity"** specifically to find this extension in the marketplace.

### First Project
1. Open VS Code Chat: `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Shift+I` (Mac)
2. Type: `@hopper /new-project`
3. Describe what you want to build
4. Watch Hopper create your roadmap and start executing

**The first phase is free** — no account, no payment. Experience the full workflow before deciding if it's right for you.

---

## All Commands

### Core Workflow
| Command | What It Does |
|---------|-------------|
| `/new-project` | Start fresh — define goals, constraints, and success criteria |
| `/create-roadmap` | Generate phased plan from your project goals |
| `/plan-phase` | Break a phase into executable steps with acceptance criteria |
| `/execute-plan` | Run the plan — Hopper writes code, makes commits, tracks progress |
| `/progress` | See what's done, what's next, and blockers |
| `/pause-work` | Save your exact state to resume later (even on different machines) |
| `/resume-work` | Pick up where you left off with full context |

### Phase Control
| Command | What It Does |
|---------|-------------|
| `/add-phase` | Append a new phase to your roadmap |
| `/insert-phase` | Squeeze an urgent phase between existing ones |
| `/remove-phase` | Delete a phase (updates numbering automatically) |
| `/research-phase` | Have Hopper research how to approach a phase before planning |
| `/discuss-phase` | Answer Hopper's questions to refine phase context |
| `/list-phase-assumptions` | See what Hopper assumes about your approach (catch misalignments early) |

### Milestones & Releases
| Command | Description |
|---------|-------------|
| `/new-milestone` | Create a new milestone with phases |
| `/complete-milestone` | Archive completed milestone |
| `/discuss-milestone` | Gather context for next milestone |

### Verification
## How Hopper Organizes Your Work

Hopper creates a `.planning/` directory in your workspace. Everything is human-readable markdown — no proprietary formats, no lock-in.

```
.planning/
├── PROJECT.md          # Your north star: goals, constraints, success criteria
├── ROADMAP.md          # High-level phases (updated as you progress)
├── PAUSE_STATE.md      # Exact state when you paused (resume from here)
├── DEFERRED_ISSUES.md  # "Later" items tracked so nothing falls through cracks
└── phases/
    └── 01-setup/
        ├── 01-01-PLAN.md    # Executable steps with ✓ tracking
        └── 01-02-PLAN.md    # Additional plans for same phase
```

**You own your data.** Edit plans in your editor. Commit to git. Share with your team. Hopper augments your workflow — it doesn't replace it.

---

## Why Developers Choose Hopper

✅ **"I can finally context-switch without losing my place"**  
Consultants juggling 3 clients, founders balancing features vs. firefighting — Hopper remembers where you were in each project.

✅ **"Planning doesn't feel like busywork anymore"**  
Because Hopper *executes* the plan. You're not creating docs that go stale — you're building a GPS for your code.

✅ **"Onboarding new devs is 10x faster"**  
New teammate? Point them at `PROJECT.md` and `ROADMAP.md`. They understand the vision and current state in 5 minutes.

✅ **"I actually ship side projects now"**  
That idea you start enthusiastically every weekend then abandon? Hopper keeps the momentum going between sessions.

✅ **"NEAR AI's verifiable privacy lets me use AI on client code"**  
Trusted Execution Environments mean my consulting clients' proprietary code never leaves encrypted enclaves. Hardware-backed proof their IP stays protected.

---

## Freemium Model

- **First phase:** Free forever. Build, test, verify — experience the full workflow.
- **Continue building:** Upgrade when ready. Seamless unlocking via NEAR wallet (no credit card required for crypto payments).

No bait-and-switch. The free tier is real value, not a demo. We make money when Hopper makes *you* more productive.

---

## Technical Details

**Requirements:** VS Code 1.104.0+, internet connection for NEAR AI integration

**NEAR AI Integration:** Hopper can use NEAR AI for model-agnostic language model support. Configure via Command Palette → `Hopper: Manage NEAR AI Connection`

**License:**  
- Extension code: [MIT](LICENSE) — Free and open source  
- Backend (API, licensing, contracts): Proprietary

You own your `.planning/` files. The extension is MIT. Backend services enable collaboration features and licensing.

**Disclaimer:**  
Hopper Velocity is provided "as is" without warranty. While security scanning helps identify vulnerabilities, it does not guarantee your code will be free from security issues or defects. Users are solely responsible for reviewing, testing, and validating all code generated or modified by this extension. Vital Point accepts no liability for security vulnerabilities, data loss, or other issues arising from use of this software. See the [MIT License](LICENSE) for full terms.

---

## Support & Community

- 🐛 [Report Issues](https://github.com/VitalPointAI/Hopper/issues)  
- 📖 [Full Documentation](https://github.com/VitalPointAI/Hopper#readme)  
- 💬 Questions? Open an issue — we're responsive

---

**Built by developers, for developers** — [VitalPointAI](https://github.com/VitalPointAI)