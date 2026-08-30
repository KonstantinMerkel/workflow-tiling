# Workflow Tiling ![Project Status: Beta](https://img.shields.io/badge/status-beta-orange.svg)

## Vision
An intuitive, user-first window manager aiming for better productivity on GNOME.

- Automatically **tiles windows**, customizable via
- a **convenient graphical tool** or pure JSON definition.
- Adds options for **new keyboard shortcuts** to navigate and reorder windows and workspaces.
- Respects your setup (Well actually mostly mine unitl now, help me by submitting your issues ;)) Still comes with Multi-monitor and docking setups supported out of the box.

## Recommended Extensions
We do not natively draw an active window border. For visual indication of the focused window, it is highly recommended to use an extension like [P7 Border](https://github.com/prasannavl/p7-borders-shell-extension).

## Custom Layouts
Easily changeable via the graphical tool in settings, or create your own JSON: see [layouts.md](layouts.md).

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md).

## Installation
Clone the repository and install using Make:

```bash
git clone https://github.com/KonstantinMerkel/workflow-tiling.
cd workflow-tiling
make install
```
Restart GNOME Shell (or log out and back in) and enable the extension via the Extension Manager or navigate back and run
```bash
make enable
```