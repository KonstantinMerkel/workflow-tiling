# Workflow Tiling

A deterministic customizable auto-tiler extension for GNOME Shell (GNOME 50+).

## Features
- **Deterministic Escalation**: Automatically tiles windows in a customizable geometric sequence.
- **Multi-Monitor Support**: Each monitor tiles independently.
- **Workspace Isolation**: Tiling states are unique to each GNOME workspace.
- **Stability Focused**: Uses WindowWrapper object modeling and compositor-native synchronization (Meta.LaterType) to prevent race conditions and Shell crashes.

## Custom Layouts
Layout transitions are configured via JSON string, supporting custom window counts and sizes.

Optional `id` integer properties (1-indexed) in the JSON structure define how windows transition between states:

```json
{
  "1": [
    {"x": 0, "y": 0, "w": 100, "h": 100, "id": 1}
  ],
  "2": [
    {"x": 0, "y": 0, "w": 50, "h": 100, "id": 1},
    {"x": 50, "y": 0, "w": 50, "h": 100, "id": 2}
  ],
  "3": [
    {"x": 0, "y": 0, "w": 33.33, "h": 100, "id": 1},
    {"x": 33.33, "y": 0, "w": 33.33, "h": 100, "id": 3},
    {"x": 66.66, "y": 0, "w": 33.34, "h": 100, "id": 2}
  ]
}
```

## Development

### Running Tests
Unit tests are written using **Vitest**.
```bash
npm install
npm test
```

### Installation
To link the extension to your local GNOME Shell directory:
```bash
ln -s $(pwd) ~/.local/share/gnome-shell/extensions/workflow-tiling@konstantin.dev
gnome-extensions enable workflow-tiling@konstantin.dev
```
