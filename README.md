# Workflow Tiling

A deterministic three-window auto-tiler extension for GNOME Shell (GNOME 50+).

## Features
- **Deterministic Escalation**: Automatically tiles windows in a fixed 1-2-3 sequence.
- **Multi-Monitor Support**: Each monitor tiles independently.
- **Workspace Isolation**: Tiling states are unique to each GNOME workspace.
- **Stability Focused**: Uses WindowWrapper object modeling and compositor-native synchronization (Meta.LaterType) to prevent race conditions and Shell crashes.

## Tiling Layouts
1. **1 Window**: Full Screen (100%).
2. **2 Windows**: 50/50 Vertical Split.
3. **3 Windows**: 50% Left Master, 25%/25% Stacked Right.
4. **4+ Windows**: Floating management fallback.

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
