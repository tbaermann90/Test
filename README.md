# Meine Aufgaben

Eine kleine To-do-Liste, die direkt im Browser läuft. Du musst nichts installieren.

## Starten

1. Lade `index.html` herunter (oder klone das Repository).
2. Doppelklick auf `index.html`. Die Datei öffnet sich in deinem Browser.

Das war's.

## Funktionen

- Aufgaben hinzufügen (Enter oder „Hinzufügen“)
- Aufgaben abhaken und löschen
- Alle erledigten Aufgaben auf einmal entfernen
- Die Aufgaben bleiben gespeichert, auch wenn du den Browser schließt
- Heller und dunkler Modus, je nach Systemeinstellung

---

# Wochencheck (gerade oder ungerade Woche?)

`wochencheck/Wochencheck.exe` ist ein kleines Windows-Programm. Doppelklick darauf, und ein Fenster zeigt dir die aktuelle Kalenderwoche und ob sie **gerade** oder **ungerade** ist.

- Die Woche wird nach ISO 8601 gezählt (so wie in deutschen Kalendern).
- Keine Installation nötig.
- Windows SmartScreen kann beim ersten Start warnen, weil die Datei nicht signiert ist: „Weitere Informationen“ → „Trotzdem ausführen“.

Neu bauen (z. B. unter Linux oder macOS mit installiertem Go):

```
cd wochencheck
GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -H windowsgui" -o Wochencheck.exe .
```
