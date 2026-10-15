# Baumarkt-Preisvergleich

Speichere deine Baumärkte und Onlineshops, füge Produkt-Links mit Menge hinzu und
sieh auf einen Blick, wo du am günstigsten einkaufst: vor Ort oder mit Lieferung.

## Starten (Windows)

1. **[Baumarkt-Preisvergleich.exe herunterladen](https://github.com/tbaermann90/Test/releases/tag/baumarkt-aktuell)**
   (unter „Assets“ auf die .exe klicken).
2. Doppelklick auf die heruntergeladene Datei. Keine Installation nötig.
3. Beim ersten Start zeigt Windows eventuell **„Der Computer wurde durch Windows geschützt“**.
   Das kommt bei allen Programmen ohne gekauftes Herausgeber-Zertifikat. Auf
   **„Weitere Informationen“** und dann **„Trotzdem ausführen“** klicken.

Die Oberfläche öffnet sich im Browser. Das Programm läuft danach mit einem
orangen Preisschild-Symbol **unten rechts neben der Uhr** weiter (eventuell
unter dem kleinen Pfeil ^). Dort kannst du per Rechtsklick:

- **Öffnen**: Oberfläche wieder anzeigen (oder Doppelklick auf das Symbol)
- **Preise jetzt prüfen**
- **Mit Windows starten**: Preise werden dann ab dem Hochfahren geprüft und
  Angebote als Windows-Benachrichtigung gemeldet
- **Beenden**

Deine Daten liegen in `%APPDATA%\Baumarkt-Preisvergleich\daten.json` und
bleiben erhalten, wenn du eine neue Version der .exe herunterlädst.

<details><summary>Für Entwickler: ohne .exe starten oder selbst bauen</summary>

- Direkt mit Python 3.9+: `python3 app.py` (Mac/Linux auch `./starten.sh`).
  Daten liegen dann in `daten.json` neben dem Skript.
- Die .exe wird automatisch von GitHub Actions gebaut
  (`.github/workflows/baumarkt-exe.yml`), sobald sich etwas in diesem Ordner ändert.
- Selbst bauen unter Windows: `pip install pyinstaller pystray pillow`, dann
  `pyinstaller --noconfirm Baumarkt-Preisvergleich.spec`. Die .exe liegt in `dist\`.

</details>

## So funktioniert's

1. **Einstellungen:** Deine Adresse eingeben und „Suchen“ klicken. Den **Umkreis**
   (z. B. 15 km) mit dem Schieberegler festlegen.
2. **Märkte:** Baumärkte anlegen. Für jeden Markt wählst du die Art:
   - *Markt vor Ort*: nur Abholung, mit Adresse für die Entfernung
   - *Onlineshop*: nur Lieferung, mit Versandkosten und „versandkostenfrei ab“
   - *Markt + Lieferung*: beides (z. B. Hornbach, OBI)
3. **Link hinzufügen:** Im Markt auf „+ Link hinzufügen“, Produktseite einfügen,
   „Abrufen“. Name, Bild, Preis, Versand und EAN werden automatisch ausgelesen.
   Menge eintragen. Für dasselbe Produkt in einem anderen Markt das bestehende
   Produkt auswählen (wird per EAN oder Name meist automatisch erkannt).
4. **Einkaufsliste:** Jedes Produkt zeigt Bild, Menge, alle Angebote mit
   Gesamtpreis und hebt die **günstigste Variante** grün hervor 🏆.

### Mit und ohne Versand

Für jedes Angebot werden zwei Wege berechnet:

| Weg | Gesamtpreis | Zählt nur, wenn … |
|---|---|---|
| 🏬 Abholung | Menge × Stückpreis | der Markt innerhalb deines Umkreises liegt |
| 🚚 Lieferung | Menge × Stückpreis + Versand (0 € ab Gratis-Grenze) | der Shop liefert |

Der Bestpreis ist immer die günstigste aller gültigen Varianten. Ist die Lieferung
inklusive Versand günstiger als jeder Markt in deinem Umkreis, wird die Lieferung
angezeigt, samt Hinweis, wie viel du dadurch sparst.

### Preise prüfen und Benachrichtigungen

- Alle Preise werden automatisch im eingestellten Abstand (Standard: 6 Stunden)
  neu abgerufen, oder sofort per „↻ Preise prüfen“.
- 🔔 Du wirst informiert, wenn ein Preis sinkt (Angebot), ein anderer Markt
  zum Bestpreis wird oder dein **Wunschpreis** erreicht ist.
- Mit „Desktop-Benachrichtigungen erlauben“ (Einstellungen) kommen die Meldungen
  auch als Systembenachrichtigung, solange die Seite offen ist. Die .exe meldet
  Angebote zusätzlich als Windows-Benachrichtigung, auch bei geschlossenem Browser.

### Im Internet vergleichen

- Hinterlege bei einem Markt eine **Such-Adresse** mit `{suche}` als Platzhalter,
  z. B. `https://www.shop.de/suche?q={suche}`. „🔍 Im Internet vergleichen“ sucht
  dann dort nach EAN bzw. Name und schlägt passende Angebote zum Übernehmen vor.
- Außerdem gibt es Direkt-Links zu idealo, Google Shopping und billiger.de.

## Grenzen

- Preise werden aus den strukturierten Daten der Shopseiten gelesen (schema.org,
  Open Graph). Einige große Baumärkte blockieren automatische Abrufe oder laden
  Preise erst per JavaScript. Dann erscheint ein Hinweis und du kannst den Preis
  per Klick auf den Stückpreis **von Hand** eintragen. Hand-Eingaben werden bei
  der automatischen Prüfung nicht überschrieben (Feld leeren = wieder automatisch).
- Die automatische Suche funktioniert nur in Shops mit hinterlegter Such-Adresse,
  deren Suchseite ohne JavaScript Ergebnisse liefert. Ein vollständiger Vergleich
  „aller Shops im Internet“ bräuchte den Zugang zu einer Preisvergleichs-API.
- Die Adresssuche nutzt OpenStreetMap (Nominatim).

## Tests

```
python3 -m unittest discover -s tests
```
