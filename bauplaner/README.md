# Holz-Bauplaner

Erstellt aus YouTube-Videos, Fotos, Links oder einer Beschreibung einen Bauplan für Holzprojekte
(Möbel, Jigs/Vorrichtungen, Deko …) – für Laien gemacht.

## Starten

**Windows-Programm:** `download/Holz-Bauplaner.exe` herunterladen und doppelklicken. Die App öffnet sich in einem eigenen Fenster,
eine Installation ist nicht nötig. Beim ersten Start warnt Windows eventuell („Der Computer wurde durch Windows geschützt“),
weil das Programm nicht signiert ist. Klicke dann auf **Weitere Informationen → Trotzdem ausführen**.

**Im Browser (alle Systeme):**
1. Ordner `bauplaner` herunterladen (oder das Repository klonen).
2. `bauplaner/index.html` doppelklicken.

Danach:
3. Oben rechts auf ⚙︎ klicken und deinen Anthropic-API-Schlüssel eintragen
   (bekommst du unter <https://console.anthropic.com/settings/keys>).

Mit **„Beispiel ansehen“** siehst du einen fertigen Plan, auch ohne API-Schlüssel.

## Was die App liefert

- **3D-Ansicht** mit Gesamtmaßen und Teilenummern, umschaltbar auf **Explosionszeichnung**
- **Teileliste** mit allen Fertigmaßen
- **Bauteilzeichnungen**: Draufsicht und Seitenansicht mit Maßlinien, Bohrungen (mit Positionen), Nuten und Ausschnitten
- **Zuschnittplan**: wie die Teile aus den gekauften Platten/Brettern gesägt werden (mit Sägeschnitt). Den kannst du im Baumarkt beim Zuschnitt vorlegen.
- **Einkaufsliste mit Preisen** aus dem Baumarkt deiner Wahl (OBI, Hornbach, Bauhaus, toom, hagebau, Globus, Hellweg …).
  Die Preise werden live im Web recherchiert und als „recherchiert“ oder „geschätzt“ markiert.
- **Schritt-für-Schritt-Anleitung**: zu jedem Schritt ein Bild, auf dem die betroffenen Teile farbig markiert sind, plus Tipps und Warnhinweise
- **Ideen zum Verschönern** (immer dabei) mit Aufwand und Mehrkosten, Profi-Tipps und Sicherheitshinweise
- **Plan anpassen**: z. B. „20 cm breiter“ oder „ohne Stichsäge“, Plan und Preise werden neu berechnet
- Projekte werden im Browser gespeichert und lassen sich als Datei sichern, drucken oder als PDF speichern

## Gut zu wissen

- Ein Video kann die KI nicht ansehen. Sie liest Titel, Beschreibung und Vorschaubild.
  **Screenshots wichtiger Szenen** (Bilder einfügen, auch mit Strg+V) und genannte Maße verbessern das Ergebnis stark.
- Ein Plan dauert meist 2–6 Minuten und kostet je nach Umfang grob 0,30–1,50 € API-Guthaben.
- Der API-Schlüssel bleibt in deinem Browser und wird nur an Anthropic gesendet. Nutze die App deshalb nur auf deinem eigenen Gerät.
- Die Pläne werden von einer KI erstellt. Prüfe Maße und Statik mit gesundem Menschenverstand, bevor du sägst.

## Technik

Reines HTML/JS ohne Build. `ki.js` ruft Claude (Opus 5.5) über das offizielle Anthropic-SDK auf
(`vendor/anthropic-sdk.js`, gebündelt aus `@anthropic-ai/sdk` 0.133.0). Dabei nutzt es Websuche und Web-Fetch für Video-Infos und Preise.
Der Bauplan kommt als strukturiertes JSON zurück. `render.js` zeichnet daraus alle Grafiken als SVG.

Die Windows-Version (`desktop/`) ist ein kleines Go-Programm. Es liefert die App über einen lokalen Server (127.0.0.1)
aus und zeigt sie in einem Microsoft-Edge-WebView2-Fenster, das in Windows 10/11 bereits enthalten ist. Projekte werden unter
`%APPDATA%\Holz-Bauplaner` gespeichert. Neu bauen (unter Linux/macOS/Windows mit Go): `desktop/build.sh`.
