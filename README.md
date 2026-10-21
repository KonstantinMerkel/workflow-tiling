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
Easily changeable via the graphical tool in settings, or create your own JSON: see [layouts.md](docs/layouts.md).

## Maximizing
Tiled windows keep their tile while maximized or fullscreen. Settings → Maximizing decides:
- **Apps maximizing themselves** (title bar, F11, opening maximized): never, only listed apps (popular browsers by default), or all except listed apps (LibreOffice and OrcaSlicer by default). Other apps are put back into their tile. List entries are app ids or WM classes; `libreoffice` also covers `libreoffice-writer`.
- **When another window comes forward** (gains focus or opens in the same layout): keep the maximization, unmaximize, or pass it on to that window. Except with keep, a layout holds one maximized window at a time: maximizing another one ends the first.
- **Hide maximize button**: removes the button from all title bars while the extension is enabled. The original layout returns when the extension is disabled. If the extension stops loading without being disabled (for example after a GNOME upgrade), restore the button with `gsettings reset org.gnome.desktop.wm.preferences button-layout`.

Super+Up toggles the maximization, Super+Down ends it. Dropping a dragged window on the top screen edge maximizes it in its tile.

## Requirements
GNOME Shell 49 or 50.

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