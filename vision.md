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
-   **Lifecycle Protection**: Window manipulations use `GLib.idle_add` and `timeout_add` to handle Mutter's volatile window lifecycle safely.
-   **Metadata Caching**: Critical window information (workspace, monitor) is cached during creation to allow safe re-tiling during window destruction.
-   **Error Shielding**: Every Mutter API interaction is wrapped in defensive checks and error handling to prevent Shell crashes.

### Scaling & Isolation
-   **Multi-Monitor Support**: Each monitor maintains an independent tiling state and respects its own work area/resolution.
-   **Workspace Isolation**: Tiling is scoped per GNOME workspace.

## Future Roadmap
1.  Gap support (configurable spacing between windows).
2.  Custom layout creation via configuration.
3.  Keyboard and mouse shortcuts for manual re-ordering.
4.  Improved monitor hotplug handling.
