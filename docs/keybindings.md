# Keybindings & Schema Shadowing

The extension uses two different strategies to bind shortcuts due to GNOME Mutter architecture limitations:

## 1. Native C-Handler Hijacking (`Meta.keybindings_set_custom_handler`)
Used strictly in `Default` mode for known GNOME shortcuts (like `<Super>Left` which GNOME maps to `toggle-tiled-left`).
* **Why:** High priority. Safely intercepts the GNOME action at the C-level before Mutter can process it.
* **Limitation:** Requires knowing the hardcoded GNOME string action name (e.g. `toggle-tiled-left`). It cannot intercept an arbitrary custom keystroke without knowing what action it triggers.

## 2. Extension Bindings (`Main.wm.addKeybinding`)
Used for all `Custom` modes and utility shortcuts.
* **Why:** Allows binding to custom `gsettings` schema keys that the user configures.
* **Limitation:** Extremely low priority. If the user picks a key (e.g., `<Super><Alt>Down`) that Mutter already listens to globally (e.g., `shift-overview-down`), Mutter consumes the event. The extension never fires.

## Dynamic Schema Shadowing (`ShadowManager`)
To bypass the limitation of `Main.wm.addKeybinding`, `ShadowManager` temporarily deletes conflicting shortcuts from GNOME settings while the extension is active.

### Execution Flow:
1. **Normalize:** Target custom keystrokes are parsed using pure JS string normalization to normalize modifier ordering (`<Alt><Super>` vs `<Super><Alt>`) and aliases without GTK dependency.
2. **Scan:** Iterates through native schemas (`wm.keybindings`, `mutter.keybindings`, `shell.keybindings`).
3. **Filter:** If a native array contains the normalized shortcut string, it is explicitly filtered out.
4. **Backup:** The *original* array is saved into `org.gnome.shell.extensions.workflow-tiling.shadowed-keybindings` (JSON string).
5. **Restore:** On `disable()` or `rebindAll()`, the JSON backup is read, and the native schema keys are written back to their exact original arrays.

### Crash Resilience
Because the backup is written to standard `gsettings` before any keys are unbound, an unexpected shell crash will not permanently destroy native user shortcuts. The state is restored perfectly on the next instantiation.
