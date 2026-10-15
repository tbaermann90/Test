"""Startpunkt der Windows-Version (Baumarkt-Preisvergleich.exe).

Das Programm läuft mit einem Symbol im Infobereich neben der Uhr weiter, auch
wenn der Browser geschlossen ist. So werden Preise im Hintergrund geprüft und
Angebote als Windows-Benachrichtigung gemeldet.
"""

import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

import app

APP_NAME = "Baumarkt-Preisvergleich"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"


def setup_logging():
    # Ohne Konsolenfenster gibt es kein stdout – Ausgaben landen in einer Logdatei.
    if sys.stdout is None or sys.stderr is None:
        os.makedirs(app.DATA_DIR, exist_ok=True)
        log = open(os.path.join(app.DATA_DIR, "protokoll.txt"), "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log


def message_box(text):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, APP_NAME, 0x40)
    except Exception:  # noqa: BLE001 - außerhalb von Windows
        print(text)


def already_running():
    try:
        with socket.create_connection((app.HOST, app.PORT), timeout=0.5):
            return True
    except OSError:
        return False


def resource(name):
    return os.path.join(app.BASE_DIR, name)


# ---------------------------------------------------------------- Autostart

def autostart_command():
    return f'"{sys.executable}" --hintergrund'


def autostart_enabled():
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY) as key:
            value, _ = winreg.QueryValueEx(key, APP_NAME)
            return value == autostart_command()
    except OSError:
        return False


def set_autostart(enabled):
    import winreg
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            winreg.SetValueEx(key, APP_NAME, 0, winreg.REG_SZ, autostart_command())
        else:
            try:
                winreg.DeleteValue(key, APP_NAME)
            except FileNotFoundError:
                pass


# ---------------------------------------------------------------- Selbsttest

def self_test():
    """Wird beim Bauen der .exe ausgeführt: startet den Server und ruft ihn ab."""
    server, url = app.start_server()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    page = urllib.request.urlopen(url + "/").read().decode("utf-8")
    js = urllib.request.urlopen(url + "/app.js").read()
    state = urllib.request.urlopen(url + "/api/state").read()
    assert "Baumarkt-Preisvergleich" in page and len(js) > 1000 and b"settings" in state
    import pystray  # noqa: F401 - muss in der .exe enthalten sein
    from PIL import Image
    Image.open(resource("icon.png")).load()
    server.shutdown()
    print("Selbsttest OK")


# ---------------------------------------------------------------- Start

def main():
    setup_logging()
    if "--selbsttest" in sys.argv:
        try:
            self_test()
        except Exception as e:  # noqa: BLE001
            print("Selbsttest fehlgeschlagen:", repr(e))
            sys.exit(1)
        sys.exit(0)

    url = f"http://{app.HOST}:{app.PORT}"
    background = "--hintergrund" in sys.argv

    # Läuft schon? Dann nur die Oberfläche öffnen.
    if already_running():
        if not background:
            webbrowser.open(url)
        return

    try:
        server, url = app.start_server()
    except OSError as e:
        message_box(f"Das Programm konnte nicht starten:\n{e}")
        return
    threading.Thread(target=server.serve_forever, daemon=True).start()

    import pystray
    from PIL import Image

    def open_ui(icon=None, item=None):
        webbrowser.open(url)

    def check_now(icon, item):
        threading.Thread(target=app.check_all, daemon=True).start()
        icon.notify("Die Preise werden jetzt im Hintergrund geprüft.", APP_NAME)

    def toggle_autostart(icon, item):
        try:
            set_autostart(not autostart_enabled())
        except OSError as e:
            message_box(f"Autostart konnte nicht geändert werden:\n{e}")

    def quit_app(icon, item):
        icon.visible = False
        icon.stop()
        server.shutdown()

    icon = pystray.Icon(
        "baumarkt", Image.open(resource("icon.png")), APP_NAME,
        menu=pystray.Menu(
            pystray.MenuItem("Öffnen", open_ui, default=True),
            pystray.MenuItem("Preise jetzt prüfen", check_now),
            pystray.MenuItem("Mit Windows starten", toggle_autostart,
                             checked=lambda item: autostart_enabled()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Beenden", quit_app),
        ))
    app.notify_hooks.append(lambda text: icon.notify(text, APP_NAME))

    def setup(icon):
        icon.visible = True
        if not background:
            open_ui()
            time.sleep(1.5)
            icon.notify("Das Programm läuft unten rechts neben der Uhr weiter und "
                        "meldet sich bei Angeboten. Beenden per Rechtsklick auf das Symbol.",
                        APP_NAME)

    icon.run(setup=setup)


if __name__ == "__main__":
    main()
