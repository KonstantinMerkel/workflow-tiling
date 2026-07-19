UUID = workflow-tiling@konstantin.dev
EXT_DIR = ~/.local/share/gnome-shell/extensions/$(UUID)
FILES = extension.js metadata.json lib/ schemas/ prefs.js

.PHONY: all sync install uninstall test pack enable disable clean reminder do_sync do_enable compile-schemas

all: sync

reminder:
	@echo ""
	@echo "========================================================="
	@echo " REMINDER: Log out and log back in for changes to take effect"
	@echo "========================================================="
	@echo ""

compile-schemas:
	glib-compile-schemas schemas/

sync: compile-schemas do_sync reminder

do_sync:
	mkdir -p $(EXT_DIR)
	cp -r $(FILES) $(EXT_DIR)/

install: compile-schemas do_sync
	@echo ""
	@echo "========================================================="
	@echo " Log out and back in, then run: make enable"
	@echo "========================================================="
	@echo ""

test:
	npm test

pack: compile-schemas
	zip -r extension.zip $(FILES)

enable: do_enable reminder

do_enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

uninstall:
	gnome-extensions disable $(UUID) 2>/dev/null || true
	rm -rf $(EXT_DIR)
	@echo "Extension uninstalled. Log out and back in to complete."

clean:
	rm -f extension.zip schemas/gschemas.compiled
