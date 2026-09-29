import json
import subprocess
from gi.repository import Gio, GLib

parent = subprocess.Popen(['dist/desktop/derp-portal-test-parent'], stdout=subprocess.PIPE, text=True)
try:
    handle = parent.stdout.readline().strip()
    assert handle.startswith('wayland:'), handle
    connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
    loop = GLib.MainLoop()
    response = []
    def received(_connection, _sender, _path, _interface, _signal, parameters):
        response.append(parameters.unpack())
        loop.quit()
    subscription = connection.signal_subscribe('org.freedesktop.portal.Desktop',
        'org.freedesktop.portal.Request', 'Response', None, None,
        Gio.DBusSignalFlags.NONE, received)
    reply = connection.call_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop',
        'org.freedesktop.portal.FileChooser', 'OpenFile',
        GLib.Variant('(ssa{sv})', (handle, 'Derp system portal test', {})),
        GLib.VariantType.new('(o)'), Gio.DBusCallFlags.NONE, 10000, None)
    request = reply.unpack()[0]
    checked = []
    def check_and_cancel():
        clients = json.loads(subprocess.check_output(['hyprctl', 'clients', '-j']))
        dialogs = [client for client in clients if client['title'] == 'Derp system portal test']
        if not dialogs:
            return True
        dialog = dialogs[0]
        pid = int(subprocess.check_output(['systemctl', '--user', 'show', 'derp-media-client.service', '-p', 'MainPID', '--value']))
        checked.append(dialog['pid'] == pid and dialog['floating'] and not dialog['xwayland'])
        connection.call_sync('org.freedesktop.portal.Desktop', request,
            'org.freedesktop.portal.Request', 'Close', None, None,
            Gio.DBusCallFlags.NONE, 5000, None)
        loop.quit()
        return False
    GLib.timeout_add(200, check_and_cancel)
    GLib.timeout_add_seconds(20, lambda: (loop.quit(), False)[1])
    loop.run()
    connection.signal_unsubscribe(subscription)
    assert checked == [True], {'checked': checked, 'response': response}
    print('PASS: system FileChooser portal routes to the installed tray process and opens a floating native Wayland child')
finally:
    parent.terminate()
    parent.wait(timeout=5)
