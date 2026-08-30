## Developer Quickstart

### Branch Structure
We follow a structured branching model to keep things organized:

*   **`master`**: This is our stable, release-ready branch. Please do not push directly here.
*   **`develop`**: This is where new features come together for integration testing. Once the testing phase is complete, `develop` merges into `master` for a new release.
*   **`feature/*`, `bugfix/*`, `refactor/*`**: Use these short-lived branches for your daily work. When ready, open a Pull Request into `develop`.
*   **`hotfix/*`** (Exception): If `master` breaks, you can create a hotfix branch to merge directly into `master`.

### Settings UI Design
We love a clean UI! For `prefs.js`, follow a **"minimal clutter, expand only after needed"** design philosophy.
Feel free to use `Adw` (libadwaita) components and bind visibility state dynamically to reduce visual noise.

### Logging
Using debuggable logging (`Logger` in `lib/logger.js`) is highly suggested. Including verbose logs for complex state sequences makes troubleshooting much easier for everyone — especially me. Thank you!

### GNOME APIs & Event-Driven Architecture
We aim to use the best solutions and APIs available for GNOME Shell.
Please rely on GNOME Shell signals (`size-changed`, `window-created`, etc.) or frame-synced deferrals (`GLib.idle_add`, `Meta.LaterType.BEFORE_REDRAW`) instead of arbitrary timeouts (`GLib.timeout_add`).

### AI Guidelines
This project has a project-level `AGENTS.md` set up. 
You may have your own requirements in `CLAUDE.md`, `CODEX.md`, `CURSOR.md`, or `GEMINI.md`.
Please make sure to tell your agent to respect both `AGENTS.md` and your local instruction file.

Submitting AI-generated code is your responsibility. Review all code thoroughly. We reserve the right to withhold review and merge for pull requests containing excessive or unreadable code.

### Testing
We highly value stability! Please make sure to write unit tests for new features—wherever possible—and run existing tests before proposing a change.
Run them easily using:
```bash
npm test
```

### Commentary & Documentation
If you implement non-trivial features you may add a documentation file like `keybindings.md` in docs/.
Otherwise the same commentary and documentation guidelines apply as the ones we all ignore in every other project ;)

## Future Development
We document everything we want to happen for the future via the issue function on GitHub.
If you want to start working on something, ensure the feature has maintainer approval first and nobody else works on it, else your work might not be merged.