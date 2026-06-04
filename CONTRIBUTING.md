# Development Guidelines for `Workflow Tiling`
Welcome! Thanks for wanting to contribute. If you have any issues please reach out to the maintainer.

## Branch Structure
We follow a structured branching model to keep things organized:

*   **`master`**: This is our stable, release-ready branch. Please do not push directly here.
*   **`develop`**: This is where new features come together for integration testing. Once the testing phase is complete, `develop` merges into `master` for a new release.
*   **`feature/*`, `bugfix/*`, `refactor/*`**: Use these short-lived branches for your daily work. When ready, open a Pull Request into `develop`.
*   **`hotfix/*`** (Exception): If `master` breaks, you can create a hotfix branch to merge directly into `master`.

## Issues and Feature Requests
Please report issues and request features under issues.

### AI Friendliness
This project has a project-level `AGENTS.md` set up. 
You may have your own requirements in `CLAUDE.md`, `CODEX.md`, `CURSOR.md`, or `GEMINI.md`.
Please make sure to tell your agent to respect both `AGENTS.md` and your local instruction file.

### Settings UI Design
We love a clean UI! For `prefs.js`, follow a **"minimal clutter, expand only after needed"** design philosophy.
Feel free to use `Adw` (libadwaita) components and bind visibility state dynamically to reduce visual noise.

### Logging
Using debuggable logging (`Logger` in `lib/logger.js`) is highly suggested. Including verbose logs for complex state sequences makes troubleshooting much easier for everyone — especially me. Thank you!

### GNOME APIs & Event-Driven Architecture
We aim to use the newest solutions and APIs available for GNOME Shell.
Please rely on GNOME Shell signals (`size-changed`, `window-created`, etc.) or frame-synced deferrals (`GLib.idle_add`, `Meta.LaterType.BEFORE_REDRAW`) instead of arbitrary timeouts (`GLib.timeout_add`).

### Testing
We highly value stability! Please make sure to write unit tests for new features—wherever possible—and run existing tests before proposing a change.
Run them easily using:
```bash
npm test
```

### Commentary & Documentation
We prefer documentation that describes the current state and behavior of the system.
* Try to keep comments focused without diary entries or historical tracking.
* If your changes affect how the system works (class names, execution flow, or API), please help us keep `architecture.md`, `layouts.md`, and `README.md` up-to-date!
