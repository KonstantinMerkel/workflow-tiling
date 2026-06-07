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

## SignalListener (`lib/signals.js`)
Binds GNOME Shell signals.
Intercepts `window-created`, `window-entered-monitor`, `window-left-monitor`.
Intercepts drag operations via `grab-op-begin` and `grab-op-end`.
Translates events to `TilingController` calls.

## KeybindingManager (`lib/keybindings.js`)
Binds global keyboard shortcuts.
Hijacks conflicting native GNOME shortcuts when necessary.
Translates keyboard events to `TilingController` actions.

## WindowWrapper (`lib/window.js`)
Encapsulates `Meta.Window`.
Applies calculated geometry.
Binds single-shot `size-changed` signals to detect external resizing.

## WorkspaceManager & WorkspaceLayout (`lib/workspace.js`)
`WorkspaceManager` tracks multiple layouts across GNOME workspaces.
`WorkspaceLayout` tracks windows per workspace and monitor.
Calculates window slots based on insertion order.
Provides window displacement and swapping logic.

## StateTracker (`lib/state.js`)
Maintains stable ordered list of windows.
Handles track and untrack operations.
Swaps window positions.

## DragManager (`lib/drag.js`)
Tracks window drag-and-drop operations.
Renders visual swap indicators.
Triggers geometric swapping based on pointer intersections.

## SettingsManager (`lib/settings.js`)
Loads configuration preferences.
Parses layout JSON into valid escalator transitions.

## Logger (`lib/logger.js`)
Provides debug and trace logging.
Configurable output verbosity.

## Escalator (`lib/layout.js`)
Generates tile geometries.
Provides geometric estates based on current window count.

## Execution Flow
Signal triggers event.
Controller receives event.
Controller updates WorkspaceLayout state.
Controller schedules deferred retile.
Retile queries Escalator for layouts.
Retile invokes WindowWrapper to apply geometries.
