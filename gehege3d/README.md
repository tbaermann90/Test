# Gehege 3D – Planer für modulare Meerschweinchengehege

Zeigt dein Gehege in 3D. Jedes Teil ist anklickbar und zeigt seine genauen Maße
und die Zuschnittmaße aller Einzelbretter.

## Starten (Windows)

1. Lade `dist/Gehege3D.exe` herunter.
2. Doppelklick auf die Datei. Ein Konsolenfenster öffnet sich, und die 3D-Ansicht
   erscheint im Browser.
3. Zum Beenden das Konsolenfenster schließen.

Windows SmartScreen kann beim ersten Start warnen, weil die Exe nicht signiert ist:
„Weitere Informationen“ → „Trotzdem ausführen“.

Dein Gehege wird automatisch in `gehege.json` gespeichert, im selben Ordner wie die Exe.

## Bedienung

- **Klick auf ein Teil**: Breite, Tiefe und Höhe erscheinen als Maßlinien, rechts stehen
  alle Einzelteile mit Zuschnittmaßen. Das angeklickte Brett ist gelb markiert.
- **Maus**: links ziehen = drehen, rechts ziehen = verschieben, Mausrad = zoomen.
- **Teile bearbeiten**: Maße, Position (x von links, z von hinten, y Höhe), Drehung und Farbe
  rechts ändern. Die Ansicht aktualisiert sich sofort.
- **Teilearten**: Grundmodul (Wanne mit Plexiglasfront und Durchgängen), Etage mit Stützen
  und Absturzkante, Rampe mit Sprossen, Häuschen mit Eingängen, Zubehör (Quader).
- **Stückliste**: alle Bretter mit Maßen, zusammengefasster Zuschnitt und Materialbedarf.
  Drucken oder als CSV (Excel) speichern.
- **Exportieren / Importieren**: Gehege als Datei sichern oder weitergeben.

Alle Maße sind in Zentimetern. Position x/z ist immer die linke hintere Ecke des Teils.

## Selbst bauen

Benötigt Go 1.22 oder neuer:

```
cd gehege3d
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o ../dist/Gehege3D.exe .
```

Die 3D-Darstellung nutzt [three.js](https://threejs.org) (MIT-Lizenz, liegt in `web/vendor`).
