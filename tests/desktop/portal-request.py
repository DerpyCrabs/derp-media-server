import json
import os
import sys
from gi.repository import Gio, GLib

request = json.loads(sys.argv[1])
options = {}
for key, value in request.get('options', {}).items():
    if key in ('multiple', 'directory', 'modal'):
        options[key] = GLib.Variant('b', value)
    elif key in ('current_folder', 'current_file'):
        options[key] = GLib.Variant('ay', list(os.fsencode(value) + b'\0'))
    elif key == 'filters':
        options[key] = GLib.Variant('a(sa(us))', value)
    elif key == 'choices':
        options[key] = GLib.Variant('a(ssa(ss)s)', value)
    elif key == 'files':
        options[key] = GLib.Variant('aay', [list(os.fsencode(name) + b'\0') for name in value])
    else:
        options[key] = GLib.Variant('s', value)
connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
handle = '/org/freedesktop/portal/desktop/request/test/' + str(os.getpid())
loop = GLib.MainLoop()

def finished(connection, result):
    try:
        print(json.dumps(connection.call_finish(result).unpack()), flush=True)
    except GLib.Error as error:
        print(str(error), file=sys.stderr, flush=True)
    loop.quit()

connection.call(os.environ['DERP_PORTAL_BUS_NAME'], '/org/freedesktop/portal/desktop',
                'org.freedesktop.impl.portal.FileChooser', request.get('method', 'OpenFile'),
                GLib.Variant('(osssa{sv})', (handle, 'derp.test', request.get('parent', ''), 'Derp picker test', options)),
                GLib.VariantType.new('(ua{sv})'), Gio.DBusCallFlags.NONE, 120000, None, finished)
if request.get('cancel'):
    def cancel():
        connection.call(os.environ['DERP_PORTAL_BUS_NAME'], handle,
                        'org.freedesktop.impl.portal.Request', 'Close', None, None,
                        Gio.DBusCallFlags.NONE, 5000, None, None)
        return False
    GLib.timeout_add(1000, cancel)
loop.run()
