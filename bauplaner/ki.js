// Spricht mit der Claude-API: wertet Videos, Bilder und Texte aus,
// recherchiert Preise im gewählten Baumarkt und liefert den Bauplan als JSON.

(function () {
  "use strict";

  const MODELL_STANDARD = "claude-opus-5-5";

  const SYSTEM = `Du bist ein erfahrener Schreinermeister und technischer Zeichner. Du erstellst Baupläne für Holzprojekte (Möbel, Vorrichtungen/Jigs für die Werkstatt, Deko und Alltagsgegenstände), die ein Heimwerker-Laie mit Baumarkt-Material und einfachem Werkzeug nachbauen kann.

So arbeitest du:
1. Verstehe genau, was gebaut werden soll. Werte alle Bilder, Video-Vorschaubilder, Links und Beschreibungen aus. Bei YouTube-Links: rufe die Seite mit web_fetch ab und/oder suche mit web_search nach Titel, Beschreibung, Kapiteln und genannten Maßen. Ein Video kannst du nicht ansehen, nur dessen Texte und Vorschaubild – sag in den Annahmen offen, was du ableiten musstest.
2. Lege sinnvolle Maße fest (Wunschmaße des Nutzers haben Vorrang). Nutze Standard-Materialstärken aus dem Baumarkt (z. B. Leimholz 18/28 mm, Multiplex 12/15/18 mm, Rahmenholz 44×44 mm, Latten 24×48 mm) und Standard-Plattengrößen, damit wenig gesägt werden muss. Viele Baumärkte bieten Zuschnitt an – nutze das in den Tipps.
3. Wähle Verbindungen, die ein Laie sicher hinbekommt (Schrauben mit Vorbohren, Taschenlochbohrungen, Dübel mit Dübelhilfe, Leim + Schrauben, Winkel/Beschläge). Berücksichtige das vorhandene Werkzeug des Nutzers und schlage für fehlendes Werkzeug Alternativen vor (z. B. Zuschnitt im Markt).
4. Recherchiere mit web_search die aktuellen Preise der Materialien im gewünschten Baumarkt (bevorzugt auf dessen Webseite, passende Artikel/Größen). Wenn du keinen Preis findest, schätze realistisch und markiere ihn als "geschätzt". Plane Verschnitt und gängige Packungsgrößen ein (Schrauben gibt es nur in Packungen).
5. Rufe zum Schluss GENAU EINMAL das Werkzeug "bauplan_abgeben" mit dem vollständigen Plan auf. Schreibe den Plan nicht zusätzlich als Text.

Regeln für den Plan:
- Alle Maße in Millimetern, alle Texte auf Deutsch, verständlich für Laien (Fachbegriffe kurz erklären).
- Koordinatensystem des fertigen Objekts: x = Breite (nach rechts), y = Tiefe (von vorne nach hinten), z = Höhe (nach oben). Ursprung = vordere linke untere Ecke. Die Vorderseite liegt bei y = 0.
- Jedes Bauteil bekommt eine kurze ID (A, B, C, …). "einbau" enthält für JEDES Exemplar (anzahl) eine achsparallele Box {x,y,z,dx,dy,dz} in eingebauter Lage. Die Boxen dürfen sich nicht überschneiden, müssen sich aber dort berühren, wo Teile verbunden sind. Die Box-Maße müssen zu Länge/Breite/Stärke des Teils passen (nur anders ausgerichtet). Schräge oder runde Teile näherst du als Box an und erklärst die Form im Hinweis und in den Bearbeitungen.
- "laenge" ist immer die längste Seite in Faserrichtung, "breite" die zweite, "staerke" die Dicke.
- Bearbeitungen (Bohrungen, Taschenlöcher, Nuten, Falze, Ausschnitte, Fasen, Rundungen) beziehen sich auf die Draufsicht des Teils: x entlang der Länge ab linker Kante, y entlang der Breite ab unterer Kante. Für Bohrungen durchmesser und tiefe angeben, für Nuten/Falze/Ausschnitte l (Länge in x) und b (Breite in y). Nicht zutreffende Zahlen = 0.
- "rohmaterial" sind die Stücke, die man im Baumarkt kauft (mit realen Handelsmaßen). Jedes Bauteil verweist über rohmaterial_id darauf. Beschläge, Schrauben, Leim, Öl usw. stehen nur in der Materialliste.
- Die Materialliste ist eine Einkaufsliste: alles, was gekauft werden muss, mit Menge, Einheit, Einzelpreis und Gesamtpreis in Euro, Preisstatus ("recherchiert" oder "geschätzt") und – wenn gefunden – Link zum Artikel.
- Die Bauschritte sind kleinschrittig und in sinnvoller Reihenfolge (Zuschnitt, Schleifen vor dem Zusammenbau, Vorbohren, Leimen, Oberfläche). Nenne pro Schritt die betroffenen Bauteil-IDs, einen Profi-Tipp und Warnungen, wo nötig.
- Gib IMMER mindestens 5 Ideen zum Verschönern/Aufwerten (z. B. Kanten fasen oder runden, Oberflächen mit Öl/Wachs/Lasur, Kontrastholz, versenkte Schrauben mit Holzstopfen, Griffe, Farbakzente, LED, Brandmalerei, Füße) mit Aufwand und ungefähren Mehrkosten, sowie Profi-Tipps für ein sauberes Ergebnis und Sicherheitshinweise.`;

  const zahl = { type: "number" };
  const text = { type: "string" };
  const box = {
    type: "object",
    properties: { x: zahl, y: zahl, z: zahl, dx: zahl, dy: zahl, dz: zahl },
    required: ["x", "y", "z", "dx", "dy", "dz"],
  };

  const BAUPLAN_TOOL = {
    name: "bauplan_abgeben",
    description: "Gibt den fertigen, vollständigen Bauplan ab. Genau einmal ganz am Ende aufrufen.",
    eager_input_streaming: true,
    input_schema: {
      type: "object",
      properties: {
        titel: text,
        kurzbeschreibung: text,
        kategorie: { type: "string", enum: ["Möbel", "Jig/Vorrichtung", "Deko", "Garten", "Aufbewahrung", "Spielzeug", "Sonstiges"] },
        schwierigkeit: { type: "integer", description: "1 = sehr einfach … 5 = anspruchsvoll" },
        bauzeit: { type: "string", description: "z. B. '1 Wochenende' oder 'ca. 4 Stunden'" },
        gesamtmasse: { type: "object", properties: { breite: zahl, tiefe: zahl, hoehe: zahl }, required: ["breite", "tiefe", "hoehe"] },
        quellen_auswertung: { type: "string", description: "Kurz: was aus Video/Bildern/Links übernommen wurde" },
        annahmen: { type: "array", items: text },
        rohmaterial: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: text, name: text,
              art: { type: "string", enum: ["platte", "brett", "leiste", "kantholz", "sonstiges"] },
              holzart: text, laenge: zahl, breite: zahl, staerke: zahl,
            },
            required: ["id", "name", "art", "laenge", "breite", "staerke"],
          },
        },
        bauteile: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: text, name: text, anzahl: { type: "integer" }, rohmaterial_id: text,
              laenge: zahl, breite: zahl, staerke: zahl,
              maserung_wichtig: { type: "boolean" },
              einbau: { type: "array", items: box },
              bearbeitungen: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    art: { type: "string", enum: ["bohrung", "senkbohrung", "taschenloch", "duebelloch", "nut", "falz", "ausschnitt", "fase", "rundung"] },
                    beschreibung: text, x: zahl, y: zahl, durchmesser: zahl, tiefe: zahl, l: zahl, b: zahl,
                  },
                  required: ["art", "beschreibung"],
                },
              },
              hinweis: text,
            },
            required: ["id", "name", "anzahl", "rohmaterial_id", "laenge", "breite", "staerke", "einbau"],
          },
        },
        materialliste: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kategorie: { type: "string", enum: ["Holz", "Verbindungsmittel", "Beschläge", "Oberfläche", "Verbrauchsmaterial", "Sonstiges"] },
              artikel: text, spezifikation: text, menge: zahl, einheit: text,
              einzelpreis: zahl, gesamtpreis: zahl,
              preis_status: { type: "string", enum: ["recherchiert", "geschätzt"] },
              link: text,
            },
            required: ["kategorie", "artikel", "menge", "einheit", "einzelpreis", "gesamtpreis", "preis_status"],
          },
        },
        preis_hinweis: { type: "string", description: "Stand/Quelle der Preise, Hinweise zu Zuschnittservice etc." },
        werkzeuge: {
          type: "array",
          items: {
            type: "object",
            properties: { name: text, notwendig: { type: "boolean" }, alternative: text },
            required: ["name", "notwendig"],
          },
        },
        schritte: {
          type: "array",
          items: {
            type: "object",
            properties: {
              titel: text, text: text,
              bauteile: { type: "array", items: text },
              tipp: text, achtung: text,
            },
            required: ["titel", "text", "bauteile"],
          },
        },
        verschoenerung: {
          type: "array",
          items: {
            type: "object",
            properties: {
              titel: text, text: text,
              aufwand: { type: "string", enum: ["gering", "mittel", "hoch"] },
              mehrkosten: text,
            },
            required: ["titel", "text", "aufwand"],
          },
        },
        profi_tipps: { type: "array", items: text },
        sicherheit: { type: "array", items: text },
      },
      required: ["titel", "kurzbeschreibung", "schwierigkeit", "gesamtmasse", "rohmaterial", "bauteile", "materialliste", "werkzeuge", "schritte", "verschoenerung", "profi_tipps", "sicherheit"],
    },
  };

  function werkzeuge() {
    return [
      { type: "web_search_20260209", name: "web_search", max_uses: 12, user_location: { type: "approximate", country: "DE", timezone: "Europe/Berlin" } },
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
      BAUPLAN_TOOL,
    ];
  }

  function youtubeId(url) {
    const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/);
    return m ? m[1] : null;
  }

  function anfrageText(e) {
    const z = [];
    z.push(`Projekt: ${e.beschreibung || "(keine Beschreibung – leite es aus den Quellen ab)"}`);
    if (e.youtube.length) z.push(`YouTube-Videos:\n${e.youtube.map((u) => "- " + u).join("\n")}`);
    if (e.links.length) z.push(`Weitere Links:\n${e.links.map((u) => "- " + u).join("\n")}`);
    if (e.zusatztext) z.push(`Zusätzliche Infos (z. B. Videobeschreibung/Transkript):\n${e.zusatztext}`);
    const m = e.masse;
    if (m.breite || m.tiefe || m.hoehe) z.push(`Wunschmaße (mm): Breite ${m.breite || "frei"}, Tiefe ${m.tiefe || "frei"}, Höhe ${m.hoehe || "frei"}`);
    z.push(`Baumarkt für Preise: ${e.markt}${e.plz ? ` (Nähe PLZ ${e.plz})` : ""}`);
    z.push(`Erfahrung: ${e.erfahrung}`);
    z.push(`Vorhandenes Werkzeug: ${e.werkzeug.length ? e.werkzeug.join(", ") : "nur Grundausstattung (Akkuschrauber, Handsäge, Zollstock)"}`);
    if (e.bilder.length) z.push(`Es sind ${e.bilder.length} Bild(er) angehängt.`);
    return z.join("\n\n");
  }

  function inhalt(e, mitVorschau) {
    const teile = [];
    for (const b of e.bilder) {
      teile.push({ type: "image", source: { type: "base64", media_type: b.typ, data: b.daten } });
    }
    if (mitVorschau) {
      for (const u of e.youtube) {
        const id = youtubeId(u);
        if (id) teile.push({ type: "image", source: { type: "url", url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } });
      }
    }
    teile.push({ type: "text", text: anfrageText(e) });
    return teile;
  }

  function aenderungsInhalt(e, plan, wunsch) {
    const teile = inhalt(e, false);
    teile.push({
      type: "text",
      text: `Hier ist der bisherige Bauplan als JSON:\n${JSON.stringify(plan)}\n\nÄnderungswunsch des Nutzers: ${wunsch}\n\nPasse den Plan entsprechend an (Maße, Bauteile, Zuschnitt, Materialliste und Preise neu prüfen) und gib den vollständigen neuen Plan mit "bauplan_abgeben" ab.`,
    });
    return teile;
  }

  /**
   * Erstellt einen Bauplan. melden(art, text) bekommt Fortschritt:
   * art = "status" | "denken" | "suche" | "plan"
   */
  async function erstelle({ apiKey, modell, eingabe, plan, wunsch, melden, signal }) {
    const client = new window.Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 20 * 60 * 1000 });
    let mitVorschau = !plan;
    const start = () => [{ role: "user", content: plan ? aenderungsInhalt(eingabe, plan, wunsch) : inhalt(eingabe, mitVorschau) }];
    let messages = start();
    let erinnert = false;
    let jsonFehler = 0;

    for (let runde = 0; runde < 15; runde++) {
      const stream = client.beta.messages.stream(
        {
          model: modell || MODELL_STANDARD,
          max_tokens: 64000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: "high" },
          system: SYSTEM,
          tools: werkzeuge(),
          messages,
        },
        { signal },
      );

      let planZeichen = 0;
      stream.on("streamEvent", (ev) => {
        if (ev.type === "content_block_start") {
          const b = ev.content_block;
          if (b.type === "server_tool_use") melden("suche", b.name === "web_fetch" ? "Lese Webseite …" : "Suche im Web …");
          if (b.type === "tool_use") melden("status", "Zeichne den Bauplan …");
          if (b.type === "thinking") melden("status", "Denke nach …");
        } else if (ev.type === "content_block_delta") {
          const d = ev.delta;
          if (d.type === "thinking_delta" && d.thinking) melden("denken", d.thinking);
          if (d.type === "input_json_delta") {
            planZeichen += d.partial_json.length;
            melden("plan", planZeichen);
          }
        }
      });

      let msg;
      try {
        msg = await stream.finalMessage();
        jsonFehler = 0;
      } catch (err) {
        if (err instanceof window.Anthropic.BadRequestError && mitVorschau && /image|url|fetch/i.test(err.message)) {
          // Das YouTube-Vorschaubild konnte nicht geladen werden – ohne erneut versuchen
          mitVorschau = false;
          messages = start();
          continue;
        }
        if (err instanceof window.Anthropic.APIError || err?.name === "AbortError" || jsonFehler++ >= 2) throw err;
        melden("status", "Antwort war unvollständig, versuche es erneut …");
        continue;
      }

      for (const b of msg.content) {
        if (b.type === "server_tool_use" && b.input) {
          const q = b.input.query || b.input.url;
          if (q) melden("suche", (b.name === "web_fetch" ? "Gelesen: " : "Gesucht: ") + q);
        }
      }

      if (msg.stop_reason === "refusal") {
        throw new Error("Claude hat diese Anfrage abgelehnt. Bitte formuliere sie anders.");
      }
      if (msg.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: msg.content });
        continue;
      }
      const aufruf = msg.content.find((b) => b.type === "tool_use" && b.name === "bauplan_abgeben");
      if (aufruf) {
        if (msg.stop_reason === "max_tokens") throw new Error("Der Plan war zu lang und wurde abgeschnitten. Bitte versuche ein einfacheres Projekt oder teile es auf.");
        const ergebnis = normalisiere(aufruf.input);
        if (!ergebnis.bauteile.length) throw new Error("Der Plan enthielt keine Bauteile. Bitte versuche es noch einmal mit mehr Infos.");
        return { plan: ergebnis, nutzung: msg.usage };
      }
      if (erinnert) throw new Error("Claude hat keinen Bauplan geliefert. Bitte versuche es noch einmal.");
      erinnert = true;
      messages.push({ role: "assistant", content: msg.content });
      messages.push({ role: "user", content: "Bitte gib jetzt den vollständigen Plan mit dem Werkzeug bauplan_abgeben ab." });
    }
    throw new Error("Zu viele Schritte – bitte versuche es noch einmal.");
  }

  // Bringt die Antwort in eine sichere Form, damit die Zeichnungen nie abstürzen.
  function normalisiere(p) {
    p = p && typeof p === "object" ? p : {};
    const arr = (v) => (Array.isArray(v) ? v : []);
    const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const s = (v) => (v == null ? "" : String(v));
    const plan = {
      titel: s(p.titel) || "Bauplan",
      kurzbeschreibung: s(p.kurzbeschreibung),
      kategorie: s(p.kategorie) || "Sonstiges",
      schwierigkeit: Math.min(5, Math.max(1, Math.round(n(p.schwierigkeit) || 2))),
      bauzeit: s(p.bauzeit),
      gesamtmasse: { breite: n(p.gesamtmasse?.breite), tiefe: n(p.gesamtmasse?.tiefe), hoehe: n(p.gesamtmasse?.hoehe) },
      quellen_auswertung: s(p.quellen_auswertung),
      annahmen: arr(p.annahmen).map(s),
      rohmaterial: arr(p.rohmaterial).map((r) => ({
        id: s(r.id), name: s(r.name), art: s(r.art) || "sonstiges", holzart: s(r.holzart),
        laenge: n(r.laenge), breite: n(r.breite), staerke: n(r.staerke),
      })),
      bauteile: arr(p.bauteile).map((t) => ({
        id: s(t.id), name: s(t.name), anzahl: Math.max(1, Math.round(n(t.anzahl) || 1)), rohmaterial_id: s(t.rohmaterial_id),
        laenge: n(t.laenge), breite: n(t.breite), staerke: n(t.staerke),
        maserung_wichtig: t.maserung_wichtig !== false,
        einbau: arr(t.einbau).map((e) => ({ x: n(e.x), y: n(e.y), z: n(e.z), dx: n(e.dx), dy: n(e.dy), dz: n(e.dz) })),
        bearbeitungen: arr(t.bearbeitungen).map((b) => ({
          art: s(b.art), beschreibung: s(b.beschreibung), x: n(b.x), y: n(b.y),
          durchmesser: n(b.durchmesser), tiefe: n(b.tiefe), l: n(b.l), b: n(b.b),
        })),
        hinweis: s(t.hinweis),
      })),
      materialliste: arr(p.materialliste).map((m) => ({
        kategorie: s(m.kategorie) || "Sonstiges", artikel: s(m.artikel), spezifikation: s(m.spezifikation),
        menge: n(m.menge), einheit: s(m.einheit), einzelpreis: n(m.einzelpreis),
        gesamtpreis: n(m.gesamtpreis) || n(m.einzelpreis) * n(m.menge),
        preis_status: m.preis_status === "recherchiert" ? "recherchiert" : "geschätzt", link: s(m.link),
      })),
      preis_hinweis: s(p.preis_hinweis),
      werkzeuge: arr(p.werkzeuge).map((w) => ({ name: s(w.name), notwendig: w.notwendig !== false, alternative: s(w.alternative) })),
      schritte: arr(p.schritte).map((st) => ({ titel: s(st.titel), text: s(st.text), bauteile: arr(st.bauteile).map(s), tipp: s(st.tipp), achtung: s(st.achtung) })),
      verschoenerung: arr(p.verschoenerung).map((v) => ({ titel: s(v.titel), text: s(v.text), aufwand: s(v.aufwand) || "mittel", mehrkosten: s(v.mehrkosten) })),
      profi_tipps: arr(p.profi_tipps).map(s),
      sicherheit: arr(p.sicherheit).map(s),
    };
    return plan;
  }

  window.KI = { erstelle, normalisiere, youtubeId, MODELL_STANDARD };
})();
