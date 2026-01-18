# Hopper

**Model-agnostic structured planning for VS Code agent chat with NEAR AI integration**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/vitalpointai.hopper?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=vitalpointai.hopper)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Features

Hopper brings structured project planning directly into VS Code's chat interface, helping you break down complex projects into manageable phases and executable plans.

### 🎯 Project Planning
- **Create structured roadmaps** with milestones and phases
- **Break down phases** into detailed, executable plans
- **Track progress** across your entire project lifecycle

### 🤖 AI-Powered Execution
- **Execute plans step-by-step** with AI assistance
- **Research phases** before committing to implementation
- **Discuss and refine** approaches through guided questioning

### ⏸️ Seamless Work Sessions
- **Pause and resume** work at any time
- **Pick up exactly where you left off** with full context
- **Track deferred issues** for later consideration

### 🔍 Discovery & Verification
- **Discovery mode** for researching existing documentation
- **User acceptance testing** guidance for verifying work
- **Assumption surfacing** to catch issues early

---

## Installation

1. Open VS Code
2. Press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (Mac)
3. Search for "Hopper"
4. Click **Install**

Or install from the command line:
```bash
code --install-extension vitalpointai.hopper
```

---

## Quick Start

1. Open VS Code's Chat panel (`Ctrl+Shift+I` or `Cmd+Shift+I`)
2. Type `@hopper` to start interacting
3. Begin with `@hopper /new-project` to initialize your first project

---

## Commands

| Command | Description |
|---------|-------------|
| `/new-project` | Initialize a new project with PROJECT.md |
| `/create-roadmap` | Create roadmap with phases for the project |
| `/plan-phase` | Create detailed execution plan for a phase |
| `/execute-plan` | Execute a PLAN.md file |
| `/progress` | Check project progress and current state |
| `/pause-work` | Save work state for later resumption |
| `/resume-work` | Resume work from previous session |
| `/status` | Show current project status and phase |
| `/help` | Show available Hopper commands |

### Phase Management
| Command | Description |
|---------|-------------|
| `/add-phase` | Add a new phase to end of roadmap |
| `/insert-phase` | Insert urgent phase between existing phases |
| `/remove-phase` | Remove a phase from roadmap |
| `/research-phase` | Research how to implement a phase before planning |
| `/discuss-phase` | Gather phase context through adaptive questioning |
| `/list-phase-assumptions` | Surface Hopper's assumptions about a phase approach |

### Milestones
| Command | Description |
|---------|-------------|
| `/new-milestone` | Create a new milestone with phases |
| `/complete-milestone` | Archive completed milestone |
| `/discuss-milestone` | Gather context for next milestone |

### Verification
| Command | Description |
|---------|-------------|
| `/verify-work` | Guide manual user acceptance testing |
| `/plan-fix` | Plan fixes for UAT issues |
| `/discovery-phase` | Research current documentation before planning |

---

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `hopper.license.contractId` | `license.hopper.near` | NEAR contract ID for license validation |
| `hopper.license.nearNetwork` | `mainnet` | NEAR network (`mainnet` or `testnet`) |
| `hopper.licenseApiUrl` | `https://hopper-license-api.vitalpointai.workers.dev` | License API URL |

---

## Requirements

- VS Code 1.104.0 or higher
- Internet connection for NEAR AI integration

---

## How It Works

Hopper creates a `.planning/` directory in your workspace to store:

```
.planning/
├── PROJECT.md          # Project overview and goals
├── ROADMAP.md          # High-level phases and milestones
├── PAUSE_STATE.md      # Saved work session state
├── DEFERRED_ISSUES.md  # Issues to address later
└── phases/
    └── 01-feature-name/
        ├── 01-01-PLAN.md    # Detailed execution plan
        └── 01-02-PLAN.md    # Additional phase plans
```

---

## NEAR AI Integration

Hopper integrates with NEAR AI to provide model-agnostic language model support. Configure your NEAR AI connection through the command palette:

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Run **Hopper: Manage NEAR AI Connection**

---

## License

[MIT](LICENSE)

---

## Support

- [Report Issues](https://github.com/vitalpointai/hopper/issues)
- [Documentation](https://github.com/vitalpointai/hopper#readme)

---

**Made with ❤️ by [VitalPointAI](https://github.com/vitalpointai)**
