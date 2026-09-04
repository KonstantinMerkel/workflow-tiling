# Workflow Tiling Architecture

System manages GNOME Shell windows via event-driven signal interception.
Architecture splits logic into discrete responsibilities.

## TilingController (`lib/controller.js`)
Central orchestration layer.
Instantiates subsystems.
Routes window events to logical state trackers.
Schedules deferred retile operations.

## MonitorManager (`lib/monitor.js`)
Tracks monitor topology.
Detects hotplug events.
Identifies stable monitor IDs.
Manages window evacuation during monitor removal.
Provides directional monitor lookup via `getMonitorInDirection()` for cross-monitor transitions.

## SignalListener (`lib/signals.js`)
Binds GNOME Shell signals.
Intercepts `window-created`, `window-entered-monitor`, `window-left-monitor`.
Intercepts drag operations via `grab-op-begin` and `grab-op-end`.
Translates events to `TilingController` calls.

## KeybindingManager (`lib/keybindings.js`)
Binds global keyboard shortcuts.
Hijacks hardcoded native GNOME shortcuts via C-handlers (`default` mode).
Delegates custom shortcut conflict resolution to `ShadowManager`.
Translates keyboard events to `TilingController` actions.

## ShadowManager (`lib/shadows.js`)
Implements Dynamic Schema Shadowing.
Scans GNOME native schemas for custom shortcut conflicts.
Temporarily unbinds conflicting native keys to allow `Main.wm.addKeybinding` to succeed.
Persists original keys in `shadowed-keybindings` state for perfect restoration on disable.

## WindowWrapper (`lib/window.js`)
Encapsulates `Meta.Window`.
Applies calculated geometry.
Binds single-shot `size-changed` signals to detect external resizing.

## WorkspaceManager & WorkspaceLayout (`lib/workspace.js`)
`WorkspaceManager` tracks multiple layouts across GNOME workspaces.
`WorkspaceManager` provides batch monitor operations (close, switch, port to workspace).
`WorkspaceLayout` tracks windows per workspace and monitor.
Calculates window slots based on insertion order.
Provides window displacement and swapping logic.
Handles cross-monitor window transitions via configurable swap or escalate behavior.

## StateTracker (`lib/state.js`)
Maintains stable ordered list of windows.
Handles track and untrack operations.
Swaps window positions.

## DragManager (`lib/drag.js`)
Tracks window drag-and-drop operations.
Renders visual swap indicators.
Triggers geometric swapping based on pointer intersections.
Handles cross-monitor drag transitions with visual previews and deferred retiles.

## SettingsManager (`lib/settings.js`)
Loads configuration preferences.
Parses layout JSON into valid escalator transitions.
Exposes monitor transition behavior configuration.

## Logger (`lib/utils/logger.js`)
Provides debug and trace logging.
Configurable output verbosity.

## Escalator (`lib/layout.js`)
Generates tile geometries.
Provides geometric estates based on current window count.
Provides edge-adjacent slot lookup via `getEdgingSlot()` for directional transitions.

## Execution Flow
Signal triggers event.
Controller receives event.
Controller updates WorkspaceLayout state.
Controller schedules deferred retile.
Retile queries Escalator for layouts.
Retile invokes WindowWrapper to apply geometries.

## Cross-Monitor Flow
Keyboard/drag triggers direction detection.
Controller/DragManager delegates to WorkspaceLayout.
WorkspaceLayout escalates or swaps window between monitor trackers.
Controller schedules retile on both monitors.
