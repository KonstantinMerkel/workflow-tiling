UUID = workflow-tiling@konstantin.dev
EXT_DIR = ~/.local/share/gnome-shell/extensions/$(UUID)
FILES = extension.js metadata.json lib/ schemas/ prefs.js

.PHONY: all sync install test pack enable disable clean

all: sync

sync:
	mkdir -p $(EXT_DIR)
	cp -r $(FILES) $(EXT_DIR)/

install: sync enable

test:
	npm test

pack:
	glib-compile-schemas schemas/ 2>/dev/null || true
	zip -r extension.zip $(FILES)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

clean:
	rm -f extension.zip
