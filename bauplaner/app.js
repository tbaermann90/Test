// Oberfläche: Eingaben sammeln, Plan anfordern, Ergebnis anzeigen, Projekte speichern.

(function () {
  "use strict";

  const { isoSVG, bauteilSVG, zuschnitt, zuschnittSVG, esc, zahl } = window.Zeichnen;
  const $ = (id) => document.getElementById(id);
  const SPEICHER = "bauplaner.projekte";
  const EINST = "bauplaner.einstellungen";

  const zustand = { bilder: [], plan: null, eingabe: null, projektId: null, abbruch: null, explodiert: false };

  // ---------- Speicher ----------

  function lesen(key, standard) {
    try { return JSON.parse(localStorage.getItem(key)) ?? standard; } catch { return standard; }
  }
  function schreiben(key, wert) {
    try { localStorage.setItem(key, JSON.stringify(wert)); return true; } catch { return false; }
  }
  const einstellungen = () => lesen(EINST, { apiKey: "", modell: window.KI.MODELL_STANDARD });

  // ---------- Eingabe ----------

  function zeilen(text) {
    return text.split(/\s*\n\s*/).map((s) => s.trim()).filter(Boolean);
  }

  function marktName() {
    return $("markt").value === "andere" ? $("marktAnders").value.trim() || "Baumarkt in Deutschland" : $("markt").value;
  }

  function sammleEingabe() {
    return {
      beschreibung: $("beschreibung").value.trim(),
      youtube: zeilen($("youtube").value),
      links: zeilen($("links").value),
      zusatztext: $("zusatz").value.trim(),
      masse: { breite: Number($("mBreite").value) || 0, tiefe: Number($("mTiefe").value) || 0, hoehe: Number($("mHoehe").value) || 0 },
      markt: marktName(),
      plz: $("plz").value.trim(),
      erfahrung: $("erfahrung").value,
      werkzeug: [...document.querySelectorAll("#werkzeug input:checked")].map((i) => i.value),
      bilder: zustand.bilder.map((b) => ({ typ: b.typ, daten: b.daten })),
    };
  }

  function fuelleEingabe(e) {
    if (!e) return;
    $("beschreibung").value = e.beschreibung || "";
    $("youtube").value = (e.youtube || []).join("\n");
    $("links").value = (e.links || []).join("\n");
    $("zusatz").value = e.zusatztext || "";
    $("mBreite").value = e.masse?.breite || "";
    $("mTiefe").value = e.masse?.tiefe || "";
    $("mHoehe").value = e.masse?.hoehe || "";
    const opt = [...$("markt").options].find((o) => o.value === e.markt);
    $("markt").value = opt ? e.markt : "andere";
    $("marktAnders").value = opt ? "" : e.markt || "";
    $("marktAnders").classList.toggle("versteckt", !!opt);
    $("plz").value = e.plz || "";
    $("erfahrung").value = e.erfahrung || "Anfänger";
    document.querySelectorAll("#werkzeug input").forEach((i) => { i.checked = (e.werkzeug || []).includes(i.value); });
    zeigeYoutube();
  }

  function zeigeYoutube() {
    const box = $("ytVorschau");
    box.innerHTML = "";
    for (const u of zeilen($("youtube").value)) {
      const id = window.KI.youtubeId(u);
      if (!id) continue;
      box.insertAdjacentHTML("beforeend", `<figure><img src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="Video-Vorschau"><figcaption>${esc(id)}</figcaption></figure>`);
    }
  }

  async function bildLaden(datei) {
    const url = URL.createObjectURL(datei);
    try {
      const img = await new Promise((ok, fehler) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = fehler;
        i.src = url;
      });
      const max = 1568;
      const f = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * f);
      c.height = Math.round(img.naturalHeight * f);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.85);
      return { name: datei.name, typ: "image/jpeg", daten: dataUrl.split(",")[1], vorschau: dataUrl };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function bilderHinzufuegen(dateien) {
    for (const d of dateien) {
      if (!d.type.startsWith("image/")) continue;
      if (zustand.bilder.length >= 12) { zeigeFehler("Maximal 12 Bilder pro Projekt."); break; }
      try { zustand.bilder.push(await bildLaden(d)); } catch { zeigeFehler(`Bild „${d.name}“ konnte nicht gelesen werden.`); }
    }
    zeigeBilder();
  }

  function zeigeBilder() {
    const box = $("bildVorschau");
    box.innerHTML = zustand.bilder.map((b, i) => `<figure><img src="${b.vorschau}" alt=""><figcaption>${esc(b.name)}</figcaption><button type="button" data-weg="${i}" aria-label="Bild entfernen">×</button></figure>`).join("");
  }

  function zeigeFehler(text) {
    const f = $("fehler");
    f.textContent = text;
    f.classList.toggle("versteckt", !text);
  }

  // ---------- Plan erstellen ----------

  async function erstellen(aenderung) {
    const { apiKey, modell } = einstellungen();
    if (!apiKey) {
      oeffneEinstellungen();
      zeigeFehler("Bitte trage zuerst deinen API-Schlüssel ein.");
      return;
    }
    const eingabe = aenderung ? zustand.eingabe || sammleEingabe() : sammleEingabe();
    if (!aenderung && !eingabe.beschreibung && !eingabe.youtube.length && !eingabe.links.length && !eingabe.bilder.length && !eingabe.zusatztext) {
      zeigeFehler("Bitte gib mindestens eine Beschreibung, einen Link oder ein Bild an.");
      return;
    }
    zeigeFehler("");
    $("protokoll").innerHTML = "";
    $("gedanken").textContent = "";
    $("fortschrittTitel").textContent = aenderung ? "Bauplan wird angepasst …" : "Bauplan wird erstellt …";
    $("eingabe").classList.add("versteckt");
    $("ergebnis").classList.add("versteckt");
    $("fortschritt").classList.remove("versteckt");
    window.scrollTo({ top: 0 });

    let letzteMeldung = "";
    const melden = (art, wert) => {
      if (art === "denken") {
        const g = $("gedanken");
        g.textContent = (g.textContent + wert).slice(-1500);
        g.scrollTop = g.scrollHeight;
      } else if (art === "plan") {
        $("fortschrittTitel").textContent = `Plan wird geschrieben … (${Math.round(wert / 1000)} KB)`;
      } else if (wert !== letzteMeldung) {
        letzteMeldung = wert;
        $("protokoll").insertAdjacentHTML("beforeend", `<li>${esc(wert)}</li>`);
        $("protokoll").scrollTop = $("protokoll").scrollHeight;
      }
    };

    zustand.abbruch = new AbortController();
    try {
      const { plan } = await window.KI.erstelle({
        apiKey, modell, eingabe,
        plan: aenderung ? zustand.plan : null,
        wunsch: aenderung,
        melden,
        signal: zustand.abbruch.signal,
      });
      zustand.plan = plan;
      zustand.eingabe = eingabe;
      if (!aenderung) zustand.projektId = null;
      projektSpeichern();
      zeigePlan();
    } catch (err) {
      $("eingabe").classList.toggle("versteckt", !!aenderung);
      if (aenderung) $("ergebnis").classList.remove("versteckt");
      const meldung = fehlerText(err);
      if (aenderung) alert(meldung); else zeigeFehler(meldung);
    } finally {
      $("fortschritt").classList.add("versteckt");
      zustand.abbruch = null;
    }
  }

  function fehlerText(err) {
    const A = window.Anthropic;
    if (err instanceof A.APIUserAbortError) return "Abgebrochen.";
    if (err instanceof A.AuthenticationError) return "Der API-Schlüssel ist ungültig. Bitte prüfe ihn in den Einstellungen.";
    if (err instanceof A.PermissionDeniedError) return "Der API-Schlüssel hat keine Berechtigung für dieses Modell.";
    if (err instanceof A.RateLimitError) return "Zu viele Anfragen – bitte warte kurz und versuche es erneut.";
    if (err instanceof A.BadRequestError) return "Die Anfrage wurde abgelehnt: " + err.message;
    if (err instanceof A.APIConnectionError) return "Keine Verbindung zu Anthropic. Bitte Internetverbindung prüfen.";
    if (err instanceof A.APIError) return `Fehler von der API (${err.status || "?"}): ${err.message}`;
    return err?.message || String(err);
  }

  // ---------- Projekte ----------

  function projektSpeichern() {
    const liste = lesen(SPEICHER, []);
    const eingabeOhneBilder = { ...zustand.eingabe, bilder: [] };
    const eintrag = { id: zustand.projektId || String(Date.now()), datum: new Date().toISOString(), plan: zustand.plan, eingabe: eingabeOhneBilder };
    zustand.projektId = eintrag.id;
    const neu = [eintrag, ...liste.filter((p) => p.id !== eintrag.id)].slice(0, 40);
    if (!schreiben(SPEICHER, neu)) schreiben(SPEICHER, neu.slice(0, 10));
  }

  function zeigeProjekte() {
    const liste = lesen(SPEICHER, []);
    $("projektListe").innerHTML = liste.length
      ? liste.map((p) => `<div class="projekt"><div><b>${esc(p.plan.titel)}</b><br><span class="muted klein">${new Date(p.datum).toLocaleString("de-DE")} · ${esc(p.eingabe?.markt || "")}</span></div><button type="button" data-oeffnen="${esc(p.id)}">Öffnen</button><button type="button" class="zweit" data-loeschen="${esc(p.id)}" aria-label="Löschen">🗑</button></div>`).join("")
      : `<p class="muted">Noch keine Projekte gespeichert.</p>`;
    $("dlgProjekte").showModal();
  }

  function oeffneProjekt(p) {
    zustand.plan = window.KI.normalisiere(p.plan);
    zustand.eingabe = p.eingabe || null;
    zustand.projektId = p.id || null;
    fuelleEingabe(p.eingabe);
    zeigePlan();
  }

  // ---------- Ergebnis ----------

  function sucheLink(markt, q) {
    const s = encodeURIComponent(q);
    const m = markt.toLowerCase();
    if (m.includes("obi")) return `https://www.obi.de/search/${s}/`;
    if (m.includes("hornbach")) return `https://www.hornbach.de/s/${s}`;
    if (m.includes("bauhaus")) return `https://www.bauhaus.info/suche/produkte?text=${s}`;
    if (m.includes("toom")) return `https://toom.de/search?query=${s}`;
    if (m.includes("hagebau")) return `https://www.hagebau.de/search/?q=${s}`;
    if (m.includes("hellweg")) return `https://www.hellweg.de/search?q=${s}`;
    if (m.includes("globus")) return `https://www.globus-baumarkt.de/suche?search=${s}`;
    return `https://www.google.com/search?q=${encodeURIComponent(markt + " " + q)}`;
  }

  const euro = (v) => (Number(v) || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });

  function zeigePlan() {
    const p = zustand.plan;
    const markt = zustand.eingabe?.markt || "Baumarkt";
    const summe = p.materialliste.reduce((s, m) => s + (Number(m.gesamtpreis) || 0), 0);
    const gm = p.gesamtmasse;
    const roh = (id) => p.rohmaterial.find((r) => r.id === id);

    let h = "";
    h += `<nav class="navi nicht-drucken">
      <a href="#uebersicht">Übersicht</a><a href="#material">Material &amp; Preise</a><a href="#zuschnitt">Zuschnitt</a>
      <a href="#bauteile">Bauteile</a><a href="#anleitung">Anleitung</a><a href="#verschoenern">Verschönern</a>
      <a href="#werkzeug-sicherheit">Werkzeug &amp; Tipps</a><a href="#anpassen">Anpassen</a></nav>`;

    // Übersicht
    h += `<section id="uebersicht" class="karte">
      <div class="titelzeile"><h1>${esc(p.titel)}</h1>
        <div class="aktionen nicht-drucken" style="margin:0">
          <button class="zweit" type="button" id="knopfDrucken">Drucken / PDF</button>
          <button class="zweit" type="button" id="knopfExport">Plan speichern (Datei)</button>
        </div></div>
      <p>${esc(p.kurzbeschreibung)}</p>
      <div class="fakten">
        <div class="fakt"><b>Maße B × T × H</b>${zahl(gm.breite)} × ${zahl(gm.tiefe)} × ${zahl(gm.hoehe)} mm</div>
        <div class="fakt"><b>Schwierigkeit</b><span class="punkte">${"●".repeat(p.schwierigkeit)}${"○".repeat(5 - p.schwierigkeit)}</span></div>
        ${p.bauzeit ? `<div class="fakt"><b>Bauzeit</b>${esc(p.bauzeit)}</div>` : ""}
        <div class="fakt"><b>Material bei ${esc(markt)}</b>ca. ${euro(summe)}</div>
        <div class="fakt"><b>Kategorie</b>${esc(p.kategorie)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px;flex-wrap:wrap;gap:8px">
        <h3 style="margin:0">3D-Ansicht</h3>
        <div class="umschalter nicht-drucken" role="group" aria-label="Ansicht">
          <button type="button" data-ansicht="zu" class="${zustand.explodiert ? "" : "an"}">Zusammengebaut</button>
          <button type="button" data-ansicht="explo" class="${zustand.explodiert ? "an" : ""}">Explosionszeichnung</button>
        </div>
      </div>
      <div class="papier" id="iso">${isoSVG(p, { beschriftung: true, masse: true, explodiert: zustand.explodiert })}</div>
      <h3 style="margin-top:20px">Teileliste</h3>
      <div class="tabelle"><table><thead><tr><th>Teil</th><th>Bezeichnung</th><th class="zahl">Anz.</th><th class="zahl">Länge</th><th class="zahl">Breite</th><th class="zahl">Stärke</th><th>Material</th></tr></thead><tbody>
      ${p.bauteile.map((t) => `<tr><td><span class="id">${esc(t.id)}</span></td><td>${esc(t.name)}</td><td class="zahl">${t.anzahl}</td><td class="zahl">${zahl(t.laenge)}</td><td class="zahl">${zahl(t.breite)}</td><td class="zahl">${zahl(t.staerke)}</td><td>${esc(roh(t.rohmaterial_id)?.name || "")}${roh(t.rohmaterial_id)?.holzart ? ` (${esc(roh(t.rohmaterial_id).holzart)})` : ""}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="muted klein">Alle Maße in Millimetern (Fertigmaße).</p>
      ${p.quellen_auswertung ? `<h3 style="margin-top:16px">Was aus deinen Quellen übernommen wurde</h3><p>${esc(p.quellen_auswertung)}</p>` : ""}
      ${p.annahmen.length ? `<h3>Annahmen</h3><ul class="liste">${p.annahmen.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : ""}
    </section>`;

    // Material
    const gruppen = {};
    for (const m of p.materialliste) (gruppen[m.kategorie] ||= []).push(m);
    h += `<section id="material" class="karte"><h2>Einkaufsliste &amp; Preise · ${esc(markt)}</h2>
      <div class="tabelle"><table><thead><tr><th>Artikel</th><th class="zahl">Menge</th><th class="zahl">Einzelpreis</th><th class="zahl">Summe</th><th>Preis</th><th class="nicht-drucken"></th></tr></thead><tbody>
      ${Object.entries(gruppen).map(([k, liste]) => `<tr class="gruppe"><td colspan="6">${esc(k)}</td></tr>` + liste.map((m) => `<tr>
        <td><b>${esc(m.artikel)}</b>${m.spezifikation ? `<br><span class="muted klein">${esc(m.spezifikation)}</span>` : ""}</td>
        <td class="zahl">${zahl(m.menge, 2)} ${esc(m.einheit)}</td><td class="zahl">${euro(m.einzelpreis)}</td><td class="zahl">${euro(m.gesamtpreis)}</td>
        <td><span class="status ${m.preis_status}">${m.preis_status}</span></td>
        <td class="nicht-drucken">${/^https?:\/\//.test(m.link) ? `<a href="${esc(m.link)}" target="_blank" rel="noopener">Artikel</a>` : `<a href="${esc(sucheLink(markt, m.artikel + " " + m.spezifikation))}" target="_blank" rel="noopener">Suchen</a>`}</td></tr>`).join("")).join("")}
      <tr class="summe"><td colspan="3">Gesamt (ca.)</td><td class="zahl">${euro(summe)}</td><td colspan="2"></td></tr>
      </tbody></table></div>
      <p class="muted klein">${esc(p.preis_hinweis || "")} Preise können je nach Markt und Tag abweichen – „geschätzt“ heißt: kein exakter Online-Preis gefunden.</p>
    </section>`;

    // Zuschnitt
    const zs = zuschnitt(p);
    h += `<section id="zuschnitt" class="karte"><h2>Zuschnittplan</h2>
      <p class="muted">So holst du die Teile aus dem gekauften Holz heraus. Viele Baumärkte sägen dir das gegen eine kleine Gebühr zu – nimm diese Seite einfach mit.</p>
      ${zs.length ? zs.map((z) => `<h3>${esc(z.roh.name)} ${zahl(z.roh.laenge)} × ${zahl(z.roh.breite)} × ${zahl(z.roh.staerke)} mm – benötigt: ${z.stuecke.length} Stück</h3>
        ${z.stuecke.map((st, i) => `<div class="papier" style="margin-bottom:12px">${zuschnittSVG(z.roh, st, i + 1)}</div>`).join("")}
        ${z.zuGross.length ? `<p class="fehler">Zu groß für dieses Rohmaterial: ${z.zuGross.map((t) => `${esc(t.id)} (${zahl(t.l)} × ${zahl(t.b)})`).join(", ")} – größere Platte nehmen oder aus mehreren Brettern verleimen.</p>` : ""}`).join("") : `<p class="muted">Kein Zuschnitt nötig.</p>`}
    </section>`;

    // Bauteile
    h += `<section id="bauteile" class="karte"><h2>Bauteilzeichnungen</h2>
      ${p.bauteile.map((t) => `<div class="teilkarte">
        <h3><span class="id">${esc(t.id)}</span> ${esc(t.name)} <span class="muted">· ${t.anzahl}× · ${zahl(t.laenge)} × ${zahl(t.breite)} × ${zahl(t.staerke)} mm</span></h3>
        <div class="papier">${bauteilSVG(p, t)}</div>
        ${t.bearbeitungen.length ? `<ul>${t.bearbeitungen.map((b) => `<li><b>${esc(b.art)}</b>${b.durchmesser ? ` Ø ${zahl(b.durchmesser, 1)} mm` : ""}${b.tiefe ? `, ${zahl(b.tiefe)} mm tief` : ""}${b.x || b.y ? ` bei x = ${zahl(b.x)} / y = ${zahl(b.y)} mm` : ""}${b.l ? `, ${zahl(b.l)} × ${zahl(b.b)} mm` : ""} – ${esc(b.beschreibung)}</li>`).join("")}</ul>` : ""}
        ${t.hinweis ? `<div class="hinweis tipp"><b>Tipp:</b>${esc(t.hinweis)}</div>` : ""}
      </div>`).join("")}
      <p class="muted klein">Bohrpositionen: x wird von der linken Kante, y von der unteren Kante der Draufsicht gemessen.</p>
    </section>`;

    // Anleitung
    // Sichtbar ist, was in diesem Schritt bearbeitet wird oder in keinem späteren Schritt mehr vorkommt
    const letzterSchritt = new Map();
    p.schritte.forEach((st, i) => st.bauteile.forEach((id) => letzterSchritt.set(id, i)));
    h += `<section id="anleitung" class="karte"><h2>Schritt-für-Schritt-Anleitung</h2>
      ${p.schritte.map((st, i) => {
        const jetzt = new Set(st.bauteile);
        const sichtbar = new Set(jetzt);
        letzterSchritt.forEach((letzter, id) => { if (letzter < i) sichtbar.add(id); });
        const bild = sichtbar.size ? `<div class="papier">${isoSVG(p, { sichtbar, hervorheben: jetzt, breite: 520 })}</div>` : "";
        return `<div class="schritt"><div>
          <h3><span class="nr">${i + 1}</span>${esc(st.titel)}</h3>
          <p>${esc(st.text)}</p>
          ${st.bauteile.length ? `<p class="klein muted">Teile: ${st.bauteile.map((id) => `<span class="id">${esc(id)}</span>`).join(" ")}</p>` : ""}
          ${st.tipp ? `<div class="hinweis tipp"><b>Tipp:</b>${esc(st.tipp)}</div>` : ""}
          ${st.achtung ? `<div class="hinweis achtung"><b>Achtung:</b>${esc(st.achtung)}</div>` : ""}
        </div><div>${bild}</div></div>`;
      }).join("")}
    </section>`;

    // Verschönern
    h += `<section id="verschoenern" class="karte"><h2>Ideen zum Verschönern &amp; Aufwerten</h2>
      <div class="ideen">${p.verschoenerung.map((v) => `<div class="idee"><h3>${esc(v.titel)}</h3><div>${esc(v.text)}</div>
        <div class="meta"><span>Aufwand: ${esc(v.aufwand)}</span>${v.mehrkosten ? `<span>${esc(v.mehrkosten)}</span>` : ""}</div></div>`).join("")}</div>
    </section>`;

    // Werkzeug & Tipps
    h += `<section id="werkzeug-sicherheit" class="karte"><h2>Werkzeug</h2>
      <ul class="liste">${p.werkzeuge.map((w) => `<li><b>${esc(w.name)}</b> ${w.notwendig ? "" : `<span class="muted">(optional)</span>`}${w.alternative ? ` – <span class="muted">Alternative: ${esc(w.alternative)}</span>` : ""}</li>`).join("")}</ul>
      ${p.profi_tipps.length ? `<h2 style="margin-top:22px">Profi-Tipps für ein sauberes Ergebnis</h2><ul class="liste">${p.profi_tipps.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      ${p.sicherheit.length ? `<h2 style="margin-top:22px">Sicherheit</h2><ul class="liste">${p.sicherheit.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
    </section>`;

    // Anpassen
    h += `<section id="anpassen" class="karte nicht-drucken"><h2>Plan anpassen</h2>
      <p class="muted">Etwas soll anders sein? Beschreibe es, die App passt Plan, Zeichnungen und Preise an.</p>
      <textarea id="aenderung" rows="3" placeholder="z. B. 20 cm breiter, mit Schublade, statt Fichte lieber Eiche, ohne Stichsäge baubar …"></textarea>
      <div class="aktionen"><button type="button" id="knopfAnpassen">Plan anpassen</button><button type="button" class="zweit" id="knopfNeu2">Neues Projekt</button></div>
    </section>`;

    $("ergebnis").innerHTML = h;
    $("eingabe").classList.add("versteckt");
    $("ergebnis").classList.remove("versteckt");
    window.scrollTo({ top: 0 });
  }

  function exportieren() {
    const daten = JSON.stringify({ format: "holz-bauplaner/1", plan: zustand.plan, eingabe: { ...zustand.eingabe, bilder: [] } }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([daten], { type: "application/json" }));
    a.download = (zustand.plan.titel || "bauplan").replace(/[^\wäöüÄÖÜß-]+/g, "_") + ".json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function neu() {
    zustand.plan = null;
    zustand.eingabe = null;
    zustand.projektId = null;
    zustand.bilder = [];
    zeigeBilder();
    $("ergebnis").classList.add("versteckt");
    $("eingabe").classList.remove("versteckt");
    window.scrollTo({ top: 0 });
  }

  // ---------- Einstellungen ----------

  function oeffneEinstellungen() {
    const e = einstellungen();
    $("apiKey").value = e.apiKey || "";
    $("modell").value = e.modell || window.KI.MODELL_STANDARD;
    $("dlgEinstellungen").showModal();
  }

  // ---------- Ereignisse ----------

  $("knopfErstellen").addEventListener("click", () => erstellen(null));
  $("knopfBeispiel").addEventListener("click", () => {
    zustand.plan = window.KI.normalisiere(window.BEISPIELPLAN);
    zustand.eingabe = { ...sammleEingabe(), bilder: [] };
    zustand.projektId = null;
    zeigePlan();
  });
  $("knopfAbbrechen").addEventListener("click", () => zustand.abbruch?.abort());
  $("knopfNeu").addEventListener("click", neu);
  $("knopfEinstellungen").addEventListener("click", oeffneEinstellungen);
  $("knopfSchliessen").addEventListener("click", () => $("dlgEinstellungen").close());
  $("knopfSpeichern").addEventListener("click", () => {
    schreiben(EINST, { apiKey: $("apiKey").value.trim(), modell: $("modell").value });
    $("dlgEinstellungen").close();
    zeigeFehler("");
  });
  $("knopfProjekte").addEventListener("click", zeigeProjekte);
  $("knopfProjekteZu").addEventListener("click", () => $("dlgProjekte").close());
  $("projektListe").addEventListener("click", (ev) => {
    const o = ev.target.closest("[data-oeffnen]");
    const l = ev.target.closest("[data-loeschen]");
    const liste = lesen(SPEICHER, []);
    if (o) {
      const p = liste.find((x) => x.id === o.dataset.oeffnen);
      $("dlgProjekte").close();
      if (p) oeffneProjekt(p);
    } else if (l && confirm("Projekt wirklich löschen?")) {
      schreiben(SPEICHER, liste.filter((x) => x.id !== l.dataset.loeschen));
      $("dlgProjekte").close();
      zeigeProjekte();
    }
  });
  $("knopfImport").addEventListener("click", () => $("importDatei").click());
  $("importDatei").addEventListener("change", async (ev) => {
    const datei = ev.target.files[0];
    ev.target.value = "";
    if (!datei) return;
    try {
      const d = JSON.parse(await datei.text());
      $("dlgProjekte").close();
      oeffneProjekt({ plan: d.plan || d, eingabe: d.eingabe || null });
      projektSpeichern();
    } catch {
      alert("Die Datei ist kein gültiger Bauplan.");
    }
  });

  $("markt").addEventListener("change", () => $("marktAnders").classList.toggle("versteckt", $("markt").value !== "andere"));
  $("youtube").addEventListener("input", zeigeYoutube);
  $("ablage").addEventListener("click", () => $("dateien").click());
  $("ablage").addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); $("dateien").click(); } });
  $("dateien").addEventListener("change", (ev) => { bilderHinzufuegen([...ev.target.files]); ev.target.value = ""; });
  $("ablage").addEventListener("dragover", (ev) => { ev.preventDefault(); $("ablage").classList.add("aktiv"); });
  $("ablage").addEventListener("dragleave", () => $("ablage").classList.remove("aktiv"));
  $("ablage").addEventListener("drop", (ev) => { ev.preventDefault(); $("ablage").classList.remove("aktiv"); bilderHinzufuegen([...ev.dataTransfer.files]); });
  document.addEventListener("paste", (ev) => {
    if ($("eingabe").classList.contains("versteckt")) return;
    const dateien = [...(ev.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (dateien.length) bilderHinzufuegen(dateien);
  });
  $("bildVorschau").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-weg]");
    if (!b) return;
    zustand.bilder.splice(Number(b.dataset.weg), 1);
    zeigeBilder();
  });

  $("ergebnis").addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.closest("#knopfDrucken")) window.print();
    else if (t.closest("#knopfExport")) exportieren();
    else if (t.closest("#knopfNeu2")) neu();
    else if (t.closest("#knopfAnpassen")) {
      const w = $("aenderung").value.trim();
      if (w) erstellen(w);
    } else if (t.closest("[data-ansicht]")) {
      zustand.explodiert = t.closest("[data-ansicht]").dataset.ansicht === "explo";
      document.querySelectorAll("[data-ansicht]").forEach((b) => b.classList.toggle("an", (b.dataset.ansicht === "explo") === zustand.explodiert));
      $("iso").innerHTML = isoSVG(zustand.plan, { beschriftung: true, masse: true, explodiert: zustand.explodiert });
    }
  });
})();
