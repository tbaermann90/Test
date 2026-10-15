# PyInstaller-Bauanleitung für Baumarkt-Preisvergleich.exe
# Bauen mit:  pyinstaller --noconfirm Baumarkt-Preisvergleich.spec
import sys

backend = "pystray._win32" if sys.platform == "win32" else "pystray._dummy"

a = Analysis(
    ["desktop.py"],
    pathex=[],
    datas=[("static", "static"), ("icon.png", ".")],
    hiddenimports=[backend],
    excludes=["tkinter", "unittest", "pydoc"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="Baumarkt-Preisvergleich",
    icon="icon.ico",
    console=False,
    upx=False,
)
