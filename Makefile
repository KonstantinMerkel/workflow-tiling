UUID = workflow-tiling@konstantin.dev
EXT_DIR = ~/.local/share/gnome-shell/extensions/$(UUID)
FILES = extension.js metadata.json lib/ schemas/ prefs.js

.PHONY: all sync install test pack enable disable clean reminder do_sync do_enable

all: sync

reminder:
	@echo ""
	@echo "========================================================="
	@echo " REMINDER: Log out and log back in for changes to take effect"
	@echo "========================================================="
	@echo ""

sync: do_sync reminder

do_sync:
	mkdir -p $(EXT_DIR)
	cp -r $(FILES) $(EXT_DIR)/

install: do_sync do_enable reminder

test:
	npm test

pack:
	glib-compile-schemas schemas/ 2>/dev/null || true
	zip -r extension.zip $(FILES)

enable: do_enable reminder

do_enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

clean:
	rm -f extension.zip
