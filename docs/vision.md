# Workflow Tiling Vision

A deterministic auto-tiler for GNOME Shell.

## Core Philosophy: Scalable Layout Transition

Layout transitions are predictable, minimal, and fully customizable. The system scales from a single window up to custom window counts using configurable layout rules before falling back to floating mode.

### Deterministic Layout Flow

- **Single Window**: Full screen layout covering all available space.
- **Multiple Windows**: Fully customizable geometric distributions via JSON configuration.
- **Fallback**: Additional windows exceeding configured count run in floating mode.

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
1.  Implement type safety
2.  Make some GNOME native shortcuts as remove active window editable in extension.
