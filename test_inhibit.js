imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const { Gtk, Gdk, GLib, Gio, Adw } = imports.gi;

const app = new Adw.Application({ application_id: 'org.test.inhibit' });

app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({ application: app, title: 'Inhibit Test' });
    
    const btn = new Gtk.Button({ label: 'Inhibit' });
    btn.connect('clicked', () => {
        const surface = win.get_surface();
        print('Surface:', surface);
        if (surface && surface.inhibit_system_shortcuts) {
            surface.inhibit_system_shortcuts(null);
            print('Inhibited! Press Super+Right to test if it is blocked.');
        } else {
            print('No inhibit_system_shortcuts method found');
        }
    });
    
    win.set_child(btn);
    win.present();
});

app.run([]);
