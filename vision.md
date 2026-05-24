# Workflow Tiling Vision

A deterministic three-window auto-tiler for GNOME Shell.

## Core Philosophy: "One Cut Away"
The layout transitions should be predictable and minimal. The extension maintains a hardcoded escalation of three layouts before falling back to standard floating management.

### Deterministic Layout Flow
1.  **Level 1 (Single Window)**: Full screen (100% width, 100% height).
2.  **Level 2 (Two Windows)**: Vertical split (50% left, 50% right).
3.  **Level 3 (Three Windows)**: Master/Stack split (50% left master, two 50% height stacks on the right).
4.  **Fallback**: Any additional windows are managed in floating mode.

## Implementation Standards

### Robustness & Stability
-   **Immutability**: Core data structures (`ScreenEstate`, `Layout`, `LayoutEscalator`) are strictly immutable and self-validating.
-   **Lifecycle Protection**: Window manipulations use `Meta.LaterType.BEFORE_REDRAW` (Compositor Laters) to synchronize with Mutter's rendering pipeline and avoid race conditions.
-   **WindowWrapper Pattern**: Native Mutter window APIs and signal lifecycles are decoupled into wrapper objects, tracking logical placement safely during animations and destruction.
-   **Error Shielding**: Every Mutter API interaction is wrapped in defensive checks and error handling to prevent Shell crashes.

### Scaling & Isolation
-   **Multi-Monitor Support**: Each monitor maintains an independent tiling state and respects its own work area/resolution.
-   **Workspace Isolation**: Tiling is scoped per GNOME workspace.

## Future Roadmap
1.  Custom layout creation via configuration.
2.  Keyboard and mouse shortcuts for manual re-ordering.
3.  Active window boarder, for now just use an extension like focus on active window/ P7 Boarder.
4.  Implement type safety (JSDoc + `@girs` types and `jsconfig.json`).
