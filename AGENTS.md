# Workflow Tiling AI Development Guidelines

## Role & Mission
You are a useful AI developer assisting with the Workflow Tiling GNOME Shell extension. 
For this purpose, you will find general project-level guidelines here.
Please also refer to your developer's exclusive instruction file (e.g., `CLAUDE.md`, `CODEX.md`, `CURSOR.md`, or `GEMINI.md`) for detailed instructions on how you can serve them best.

## General Mandates

### 1. Testing Mandate
**ALWAYS** run unit tests before proposing a change.
**ALWAYS** write unit tests for new features. A task is not considered "ready for testing" until unit tests are written and pass.
```bash
npm test
```

### 2. Commentary & Documentation Rules
Documentation focuses on the current state and behavior of the system.
Avoid numbered lists for documentation or commentary.
Exclude explanations of why alternative approaches were rejected.
Do not use temporal language such as "new", "now", or "replaced".
Refrain from "diary comments" that describe the history or process of changes.

**CRITICAL DOCS MANDATE**: Always keep documentation files (`architecture.md`, `layouts.md`, `README.md`, etc.) up-to-date when altering code functionality. If you change a class name, execution flow, or API, immediately update the relevant docs.

### 3. Logging Suggestion
It is highly suggested to use debuggable logging (`Logger` in `lib/utils/logger.js`). When debugging complex flows, include verbose logs for state sequences to aid troubleshooting.

### 4. Settings UI Design
Follow a **"minimal clutter, expand only after needed"** design philosophy for `prefs.js`. 
Examples from the current codebase:
- "Inner Gaps" and "Outer Gaps" spinrows only appear when "Enable Gaps" is toggled on.
- Custom shortcuts rows only appear when "Mode" is set to "Custom".
- The Advanced JSON Editor page only mounts when explicitly toggled.
Always use `Adw` (libadwaita) components. Bind visibility state dynamically to reduce visual noise for the average user.

### 5. Gnome API Guidelines
Always use the newest solutions and APIs for GNOME Shell.

### 6. Event-Driven Architecture
Avoid arbitrary timeouts. Rely on GNOME Shell signals (`size-changed`, `window-created`, etc.) or frame-synced deferrals (`GLib.idle_add`, `Meta.LaterType.BEFORE_REDRAW`) instead of `GLib.timeout_add`.

## Cross References
- **Architecture**: See `architecture.md` for discrete responsibilities and execution flow. **Note**: We rely on *insertion-order based slots* (historical tracking) rather than purely arbitrary visual spatial arrangements. `StateTracker` matches windows to slots via their internal IDs (`get_id()`).
- **Layout JSONs**: See `layouts.md` for guidelines on how the Escalator layouts and transitions are formatted in JSON.
- **Vision**: See `vision.md` for core philosophy and scaling design.
