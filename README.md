[![Project Status: Beta](https://img.shields.io/badge/status-beta-orange.svg)](https://github.com/KonstantinMerkel/workflow-tiling)

# Workflow Tiling
A deterministic customizable auto-tiler extension for GNOME Shell (GNOME 50+).

## Summary
- [Workflow Tiling](#workflow-tiling)
  - [Summary](#summary)
  - [Features](#features)
  - [Customizations](#customizations)
    - [Custom Layouts](#custom-layouts)
  - [Development](#development)
    - [Contributing](#contributing)
    - [Running Tests](#running-tests)
    - [Installation](#installation)
  - [Recommended Extensions](#recommended-extensions)

## Features
- **Deterministic Escalation**: Automatically tiles windows in a customizable geometric sequence.
- **Multi-Monitor Support**: Each monitor tiles independently.
- **Workspace Isolation**: Tiling states are unique to each GNOME workspace.
- **Stability Focused**: Uses WindowWrapper object modeling and compositor-native synchronization (Meta.LaterType) to prevent race conditions and Shell crashes.

## Customizations

Customizations like window gaps and keybinds can be customized under `Gnome Extension Manager` > `Workflow Tiling` > Settings.
Please be warned that duplicate shortcuts can lead to unexpected window movement.

### Custom Layouts
Layout transitions are configured via JSON string, supporting custom window counts and sizes.

Optional `id` (1-indexed) integer properties in the JSON structure define how windows transition between states. It is required for all elements:
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

### Contributing
see [CONTRIBUTING.md](CONTRIBUTING.md)

### Running Tests
Unit tests are written using **Vitest**.
```bash
npm install
make test
```

### Installation
To deploy the extension to your local GNOME Shell directory:
```bash
make install
```

## Recommended Extensions
Workflow Tiling does not natively draw an active window border. For visual indication of the focused window, it is highly recommended to use an extension like **P7 Border** 