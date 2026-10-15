"use strict";

let state = null;
let view = "liste";
let lastUnread = null;
let modalSubmit = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const euro = (v) => v == null ? "–" :
  v.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const numIn = (v) => v == null ? "" : String(v).replace(".", ",");
const fmtDate = (iso) => iso ? new Date(iso).toLocaleString("de-DE",
  { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nie";
const KIND = { markt: "Markt vor Ort", online: "Onlineshop", beides: "Markt + Lieferung" };

// ---------------------------------------------------------------- API

async function api(method, path, body) {
  const res = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Baumarkt": "1" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: "Keine Antwort vom Server" }));
  if (!res.ok) throw new Error(data.error || "Fehler");
  return data;
}

async function mutate(method, path, body) {
  const data = await api(method, path, body);
  if (data && data.products) { state = data; render(); }
  return data;
}

async function load() {
  try {
    state = await api("GET", "state");
    render();
  } catch (e) { toast("Server nicht erreichbar – läuft app.py?"); }
}

// ---------------------------------------------------------------- Helfer

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

function hashColor(s) {
  let h = 0; for (const c of s || "") h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 48%)`;
}

function thumb(name, image) {
  const initials = (name || "?").split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0].toUpperCase()).join("");
  const ph = `<div class="ph" style="background:${hashColor(name)}">${esc(initials)}</div>`;
  if (!image) return `<div class="thumb">${ph}</div>`;
  return `<div class="thumb"><img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer"
    data-initials="${esc(initials)}" data-color="${hashColor(name)}" onerror="imgFail(this)"></div>`;
}

function imgFail(img) {
  const ph = document.createElement("div");
  ph.className = "ph"; ph.textContent = img.dataset.initials; ph.style.background = img.dataset.color;
  img.replaceWith(ph);
}

function sparkline(history) {
  const pts = (history || []).map((h) => h.price).filter((p) => p != null);
  if (pts.length < 2) return "";
  const w = 54, h = 16, min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - ((p - min) / span) * (h - 2) - 1}`).join(" ");
  const color = pts.at(-1) < pts.at(-2) ? "var(--good)" : pts.at(-1) > pts.at(-2) ? "var(--bad)" : "var(--muted)";
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <polyline points="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

function trend(history) {
  const pts = (history || []).filter((h) => h.price != null);
  if (pts.length < 2) return "";
  const a = pts.at(-2).price, b = pts.at(-1).price;
  if (b < a) return `<span class="trend-down" title="vorher ${euro(a)}">▼</span>`;
  if (b > a) return `<span class="trend-up" title="vorher ${euro(a)}">▲</span>`;
  return "";
}

const storeById = (id) => state.stores.find((s) => s.id === id);
const productById = (id) => state.products.find((p) => p.id === id);

// ---------------------------------------------------------------- Rendering

function render() {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  $$(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
  renderBell();
  if (view === "liste") renderList();
  if (view === "maerkte") renderStores();
  if (view === "einstellungen") renderSettings();
}

function renderBell() {
  const b = $("#bell-badge");
  b.hidden = !state.unread; b.textContent = state.unread;
  $("#notif-list").innerHTML = state.notifications.length ? state.notifications.map((n) => `
    <li class="${n.read ? "" : "unread"}">${{ angebot: "🏷️", bestpreis: "🏆", wunschpreis: "🎯" }[n.kind] || "ℹ️"}
      ${esc(n.text)}<time>${fmtDate(n.created)}</time></li>`).join("")
    : `<li class="empty">Noch keine Benachrichtigungen.<br>Sobald ein Preis sinkt, erscheint hier eine Meldung.</li>`;
  if (lastUnread !== null && state.unread > lastUnread && window.Notification?.permission === "granted") {
    const n = state.notifications.find((x) => !x.read);
    if (n) new Notification("Baumarkt-Preisvergleich", { body: n.text });
  }
  lastUnread = state.unread;
}

function renderList() {
  const el = $("#view-liste");
  const products = state.products;
  const withBest = products.filter((p) => p.evaluation.best);
  const savings = products.reduce((s, p) => s + (p.evaluation.savings || 0), 0);

  if (!state.stores.length || !products.length) {
    el.innerHTML = `<div class="empty-state"><div class="big">🧰</div>
      <h2>${state.stores.length ? "Noch keine Produkte" : "Willkommen!"}</h2>
      <p>${state.stores.length
        ? "Öffne einen Markt und füge einen Link zu einem Produkt hinzu."
        : "Lege zuerst deine Baumärkte und Onlineshops an. Danach kannst du Produkt-Links hinzufügen."}</p>
      <button class="btn" id="empty-go">${state.stores.length ? "Link hinzufügen" : "Ersten Markt anlegen"}</button></div>`;
    $("#empty-go").onclick = () => state.stores.length ? openAddLink() : openStoreForm();
    return;
  }

  el.innerHTML = `
    <div class="summary">
      <div class="stat highlight"><div class="label">Gesamt zum Bestpreis</div><div class="value">${euro(state.grand_total)}</div></div>
      <div class="stat"><div class="label">Produkte mit Preis</div><div class="value">${withBest.length} / ${products.length}</div></div>
      <div class="stat"><div class="label">Ersparnis ggü. teuerster Variante</div><div class="value">${euro(savings)}</div></div>
      <div class="stat"><div class="label">Umkreis · letzte Prüfung</div><div class="value" style="font-size:1rem;padding-top:8px">${numIn(state.settings.radius_km)} km · ${fmtDate(state.settings.last_full_check)}</div></div>
    </div>
    <div class="section-head"><h1>Einkaufsliste</h1>
      <button class="btn" id="btn-add-link">+ Produkt-Link hinzufügen</button></div>
    ${products.map(productCard).join("")}`;
  $("#btn-add-link").onclick = () => openAddLink();
  bindProductEvents(el);
}

function productCard(p) {
  const ev = p.evaluation, best = ev.best;
  const bestStore = best && storeById(p.offers.find((o) => o.id === best.offer_id)?.store_id);
  const way = (t) => t === "abholung" ? "🏬 Abholung" : "🚚 Lieferung";

  const rows = [];
  for (const o of p.offers) {
    const s = storeById(o.store_id);
    const opts = ev.rows.find((r) => r.offer_id === o.id)?.options || [];
    const nameCell = `<div class="store-name"><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(s?.name || "?")} ↗</a></div>
      ${o.error ? `<div class="err" title="${esc(o.error)}">⚠ Abruf fehlgeschlagen</div>`
        : `<div class="sub hide-sm">geprüft ${fmtDate(o.last_checked)}</div>`}`;
    const priceCell = `<span class="editable" data-edit-offer="${o.id}" title="Preis bearbeiten">${euro(o.unit_price)}</span> ${trend(o.history)}${sparkline(o.history)}`;
    const actions = `<button class="link" data-refresh="${o.id}" title="Preis neu abrufen">↻</button>
      <button class="link" data-del-offer="${o.id}" title="Link entfernen" style="color:var(--muted)">✕</button>`;
    if (!opts.length) {
      rows.push(`<tr><td>${nameCell}</td><td class="num">${priceCell}</td>
        <td colspan="3"><button class="link" data-edit-offer="${o.id}">Preis eintragen</button></td><td>${actions}</td></tr>`);
      continue;
    }
    for (const opt of opts) {
      const isBest = best && best.offer_id === o.id && best.type === opt.type;
      rows.push(`<tr class="${isBest ? "best" : ""} ${opt.available ? "" : "off"}">
        <td>${nameCell}</td>
        <td class="num">${priceCell}</td>
        <td class="hide-sm">${way(opt.type)}<div class="sub">${esc(opt.note)}</div></td>
        <td class="num hide-sm">${opt.type === "lieferung" ? euro(opt.shipping) : "–"}</td>
        <td class="num total">${euro(opt.total)}${isBest ? " 🏆" : ""}
          <div class="sub show-sm">${opt.type === "abholung" ? "🏬" : "🚚"} ${esc(opt.note)}</div></td>
        <td style="white-space:nowrap">${actions}</td></tr>`);
    }
  }

  const chips = [];
  if (ev.best_pickup) chips.push(`<span class="chip ${best?.type === "abholung" ? "win" : ""}">Vor Ort am günstigsten: ${euro(ev.best_pickup.total)}</span>`);
  else chips.push(`<span class="chip">Kein Markt im Umkreis</span>`);
  if (ev.best_delivery) chips.push(`<span class="chip ${best?.type === "lieferung" ? "win" : ""}">Mit Versand am günstigsten: ${euro(ev.best_delivery.total)}</span>`);
  if (best?.type === "lieferung" && ev.best_pickup) chips.push(`<span class="chip warn">Lieferung spart ${euro(ev.best_pickup.total - best.total)} ggü. Markt vor Ort</span>`);
  if (p.target_price) chips.push(`<span class="chip">🎯 Wunschpreis ${euro(p.target_price)}/Stück</span>`);

  return `<article class="product" data-pid="${p.id}">
    <div class="product-top">
      ${thumb(p.name, p.image)}
      <div>
        <h3>${esc(p.name)}</h3>
        <div class="meta">
          <span class="qty"><button data-qty="-1" aria-label="weniger">−</button>
            <input type="number" min="1" value="${ev.quantity}" data-qty-input aria-label="Menge">
            <button data-qty="1" aria-label="mehr">+</button></span>
          <span>Stück</span>
          ${p.gtin ? `<span>EAN ${esc(p.gtin)}</span>` : ""}
          <span>${p.offers.length} ${p.offers.length === 1 ? "Angebot" : "Angebote"}</span>
        </div>
      </div>
      <div class="best-box">${best
        ? `<div class="where">Bestpreis gesamt</div><div class="price">${euro(best.total)}</div>
           <div class="where">${esc(bestStore?.name)} · ${way(best.type)}</div>
           <div class="where">${euro(best.total / ev.quantity)} pro Stück</div>`
        : `<div class="none">Noch kein Preis im Umkreis</div>`}</div>
    </div>
    <div class="ways">${chips.join("")}</div>
    <div class="table-wrap"><table class="offers">
      <thead><tr><th>Markt / Shop</th><th class="num">Stückpreis</th><th class="hide-sm">Weg</th>
        <th class="num hide-sm">Versand</th><th class="num">Gesamt</th><th></th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table></div>
    <div class="product-actions">
      <button class="btn small" data-compare>🔍 Im Internet vergleichen</button>
      <button class="btn ghost small" data-add-offer>+ Weiteren Markt</button>
      <button class="btn ghost small" data-edit-product>Bearbeiten / Wunschpreis</button>
      <span class="spacer"></span>
      <button class="btn danger small" data-del-product>Löschen</button>
    </div>
  </article>`;
}

function bindProductEvents(root) {
  $$(".product", root).forEach((card) => {
    const pid = card.dataset.pid;
    const input = $("[data-qty-input]", card);
    const setQty = (q) => mutate("PUT", "products/" + pid, { quantity: Math.max(1, q) }).catch((e) => toast(e.message));
    $$("[data-qty]", card).forEach((b) => (b.onclick = () => setQty(+input.value + +b.dataset.qty)));
    input.onchange = () => setQty(+input.value || 1);
    $("[data-compare]", card).onclick = () => openCompare(pid);
    $("[data-add-offer]", card).onclick = () => openAddLink(null, pid);
    $("[data-edit-product]", card).onclick = () => openProductForm(pid);
    $("[data-del-product]", card).onclick = () => {
      if (confirm("Produkt mit allen Links löschen?")) mutate("DELETE", "products/" + pid);
    };
  });
  $$("[data-edit-offer]", root).forEach((b) => (b.onclick = () => openOfferForm(b.dataset.editOffer)));
  $$("[data-del-offer]", root).forEach((b) => (b.onclick = () => {
    if (confirm("Diesen Link entfernen?")) mutate("DELETE", "offers/" + b.dataset.delOffer);
  }));
  $$("[data-refresh]", root).forEach((b) => (b.onclick = async () => {
    b.innerHTML = '<span class="spinner"></span>';
    try { await mutate("POST", `offers/${b.dataset.refresh}/refresh`); toast("Preis aktualisiert"); }
    catch (e) { toast(e.message); render(); }
  }));
}

function renderStores() {
  const el = $("#view-maerkte");
  const head = `<div class="section-head"><h1>Meine Märkte & Shops</h1>
    <button class="btn" id="btn-new-store">+ Markt anlegen</button></div>`;
  if (!state.stores.length) {
    el.innerHTML = head + `<div class="empty-state"><div class="big">🏬</div><h2>Noch keine Märkte</h2>
      <p>Lege Baumärkte in deiner Nähe (z.&nbsp;B. OBI, Hornbach, Bauhaus) oder Onlineshops an.</p></div>`;
  } else {
    el.innerHTML = head + `<div class="stores">${state.stores.map((s) => {
      const offers = state.products.flatMap((p) => p.offers.filter((o) => o.store_id === s.id).map((o) => ({ o, p })));
      const dist = s.kind === "online" ? "liefert"
        : s.distance_km == null ? "Entfernung unbekannt"
        : `${numIn(s.distance_km)} km${s.in_radius ? "" : " · außerhalb Umkreis"}`;
      return `<div class="store">
        <div class="store-head"><div>
          <h3>${esc(s.name)}</h3>
          <div class="meta"><span class="chip">${KIND[s.kind]}</span><span class="chip ${s.kind !== "online" && !s.in_radius ? "warn" : ""}">${dist}</span></div>
          ${s.address ? `<div class="sub" style="margin-top:6px">${esc(s.address)}</div>` : ""}
          ${s.kind !== "markt" ? `<div class="sub">Versand ${s.shipping_cost == null ? "unbekannt" : euro(s.shipping_cost)}${s.free_shipping_from != null ? ` · frei ab ${euro(s.free_shipping_from)}` : ""}</div>` : ""}
        </div><button class="link" data-edit-store="${s.id}">Bearbeiten</button></div>
        <ul>${offers.length ? offers.map(({ o, p }) => `<li>${thumb(p.name, p.image)}
          <div><div style="font-weight:600">${esc(p.name)}</div><div class="sub">${p.quantity} Stück · <a href="${esc(o.url)}" target="_blank" rel="noopener">Link ↗</a></div></div>
          <div class="num" style="text-align:right"><strong>${euro(o.unit_price)}</strong><div class="sub">${o.unit_price != null ? euro(o.unit_price * p.quantity) + " gesamt" : ""}</div></div></li>`).join("")
          : `<li style="display:block;color:var(--muted)">Noch keine Links in diesem Markt.</li>`}</ul>
        <div class="foot"><button class="btn small" data-add-link="${s.id}">+ Link hinzufügen</button></div>
      </div>`;
    }).join("")}</div>`;
  }
  $("#btn-new-store").onclick = () => openStoreForm();
  $$("[data-edit-store]", el).forEach((b) => (b.onclick = () => openStoreForm(b.dataset.editStore)));
  $$("[data-add-link]", el).forEach((b) => (b.onclick = () => openAddLink(b.dataset.addLink)));
}

function renderSettings() {
  const s = state.settings;
  const el = $("#view-einstellungen");
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  el.innerHTML = `
    <div class="section-head"><h1>Einstellungen</h1></div>
    <div class="card"><h2>📍 Mein Standort & Umkreis</h2>
      <div class="form">
        <div class="field"><label>Meine Adresse</label>
          <div class="inline"><input id="set-address" value="${esc(s.home.address)}" placeholder="z. B. Hauptstraße 1, 80331 München">
          <button class="btn ghost" id="set-geo">Suchen</button></div>
          <div class="hint" id="set-geo-info">${s.home.lat != null ? `Standort gesetzt (${s.home.lat.toFixed(4)}, ${s.home.lon.toFixed(4)})` : "Noch kein Standort gesetzt – alle Märkte gelten als „in der Nähe“."}</div>
        </div>
        <div class="field"><label>Umkreis für Märkte vor Ort: <strong id="radius-out">${numIn(s.radius_km)} km</strong></label>
          <input type="range" id="set-radius" min="1" max="100" value="${s.radius_km}">
          <div class="hint">Märkte außerhalb dieses Umkreises zählen nicht für die Abholung. Lieferungen werden immer verglichen – ist eine Lieferung inklusive Versand günstiger, wird sie als Bestpreis angezeigt.</div>
        </div>
      </div>
    </div>
    <div class="card"><h2>🔔 Preisprüfung & Benachrichtigungen</h2>
      <div class="form">
        <div class="field"><label>Preise automatisch prüfen alle … Stunden (0 = nie)</label>
          <input type="number" id="set-interval" min="0" step="1" value="${s.check_interval_hours}" style="max-width:140px"></div>
        <div class="field"><label>Benachrichtigungen auf dem Desktop</label>
          ${perm === "granted" ? `<div class="hint">✅ Aktiviert – solange die Seite geöffnet ist.</div>`
            : perm === "unsupported" ? `<div class="hint">Dein Browser unterstützt keine Benachrichtigungen.</div>`
            : `<button class="btn ghost" id="set-notify">Desktop-Benachrichtigungen erlauben</button>`}
          <div class="hint">Du wirst informiert, wenn ein Preis sinkt, ein neuer Bestpreis entsteht oder dein Wunschpreis erreicht ist.</div>
        </div>
      </div>
    </div>`;
  const save = (body) => mutate("PUT", "settings", body).then(() => toast("Gespeichert")).catch((e) => toast(e.message));
  $("#set-radius").oninput = (e) => ($("#radius-out").textContent = e.target.value + " km");
  $("#set-radius").onchange = (e) => save({ radius_km: e.target.value });
  $("#set-interval").onchange = (e) => save({ check_interval_hours: e.target.value });
  $("#set-geo").onclick = async () => {
    const address = $("#set-address").value.trim();
    if (!address) return save({ address: "", lat: null, lon: null });
    $("#set-geo").innerHTML = '<span class="spinner"></span>';
    try {
      const g = await api("POST", "geocode", { address });
      await save({ address, lat: g.lat, lon: g.lon });
    } catch (e) { toast(e.message); render(); }
  };
  const n = $("#set-notify");
  if (n) n.onclick = () => Notification.requestPermission().then(render);
}

// ---------------------------------------------------------------- Dialoge

function openModal(title, html, onSubmit) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  modalSubmit = onSubmit || null;
  const d = $("#modal");
  if (!d.open) d.showModal();
  $("input:not([type=hidden]), select", d)?.focus();
}
function closeModal() { $("#modal").close(); modalSubmit = null; }
function showError(msg) {
  const box = $("#modal-error");
  if (box) { box.textContent = msg; box.hidden = false; } else toast(msg);
}

function openStoreForm(id) {
  const s = id ? storeById(id) : { name: "", kind: "markt", address: "", lat: null, lon: null, shipping_cost: null, free_shipping_from: null, search_url: "" };
  const kinds = Object.entries(KIND).map(([k, v]) =>
    `<label><input type="radio" name="kind" value="${k}" ${s.kind === k ? "checked" : ""}>${v}</label>`).join("");
  openModal(id ? "Markt bearbeiten" : "Markt anlegen", `<div class="form">
    <div class="alert error" id="modal-error" hidden></div>
    <div class="field"><label>Name</label><input id="f-name" value="${esc(s.name)}" placeholder="z. B. OBI München-Pasing" required></div>
    <div class="field"><label>Art</label><div class="segmented">${kinds}</div></div>
    <div class="field" id="g-address"><label>Adresse des Marktes</label>
      <div class="inline"><input id="f-address" value="${esc(s.address)}" placeholder="Straße, PLZ Ort">
      <button type="button" class="btn ghost" id="f-geo">Suchen</button></div>
      <div class="hint" id="f-geo-info">${s.lat != null ? `Standort gesetzt (${s.lat.toFixed(4)}, ${s.lon.toFixed(4)})` : "Mit „Suchen“ wird die Entfernung zu dir berechnet."}</div>
      <input type="hidden" id="f-lat" value="${s.lat ?? ""}"><input type="hidden" id="f-lon" value="${s.lon ?? ""}">
    </div>
    <div class="row" id="g-ship">
      <div class="field"><label>Versandkosten (€)</label><input id="f-ship" inputmode="decimal" value="${numIn(s.shipping_cost)}" placeholder="z. B. 4,95"></div>
      <div class="field"><label>Versandkostenfrei ab (€)</label><input id="f-free" inputmode="decimal" value="${numIn(s.free_shipping_from)}" placeholder="optional"></div>
    </div>
    <div class="field"><label>Such-Adresse für den Internet-Vergleich (optional)</label>
      <input id="f-search" value="${esc(s.search_url)}" placeholder="https://www.shop.de/suche?q={suche}">
      <div class="hint">Öffne im Shop eine Suche, kopiere die Adresse und ersetze den Suchbegriff durch <code>{suche}</code>. Dann sucht „Im Internet vergleichen“ dort automatisch nach deinen Produkten.</div></div>
    <div class="modal-actions">
      ${id ? `<button type="button" class="btn danger" id="f-del">Markt löschen</button><span style="flex:1"></span>` : ""}
      <button type="button" class="btn ghost" data-cancel>Abbrechen</button>
      <button type="submit" class="btn">Speichern</button></div></div>`, async () => {
    const body = {
      name: $("#f-name").value, kind: $("input[name=kind]:checked").value,
      address: $("#f-address").value, lat: $("#f-lat").value || null, lon: $("#f-lon").value || null,
      shipping_cost: $("#f-ship").value, free_shipping_from: $("#f-free").value, search_url: $("#f-search").value,
    };
    await mutate(id ? "PUT" : "POST", id ? "stores/" + id : "stores", body);
    closeModal(); toast("Markt gespeichert");
  });
  const sync = () => {
    const k = $("input[name=kind]:checked").value;
    $("#g-address").hidden = k === "online";
    $("#g-ship").hidden = k === "markt";
  };
  $$("input[name=kind]").forEach((r) => (r.onchange = sync)); sync();
  $("#f-geo").onclick = async () => {
    const address = $("#f-address").value.trim();
    if (!address) return;
    $("#f-geo-info").innerHTML = '<span class="spinner"></span> Suche …';
    try {
      const g = await api("POST", "geocode", { address });
      $("#f-lat").value = g.lat; $("#f-lon").value = g.lon;
      $("#f-geo-info").textContent = "Gefunden: " + g.display;
    } catch (e) { $("#f-geo-info").textContent = e.message; }
  };
  const del = $("#f-del");
  if (del) del.onclick = () => {
    if (confirm("Markt und alle seine Links löschen?")) mutate("DELETE", "stores/" + id).then(closeModal);
  };
}

function openAddLink(storeId, productId) {
  if (!state.stores.length) return openStoreForm();
  const storeOpts = state.stores.map((s) => `<option value="${s.id}" ${s.id === storeId ? "selected" : ""}>${esc(s.name)} (${KIND[s.kind]})</option>`).join("");
  const prodOpts = `<option value="">➕ Neues Produkt</option>` + state.products.map((p) =>
    `<option value="${p.id}" ${p.id === productId ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  let scraped = {};
  openModal("Produkt-Link hinzufügen", `<div class="form">
    <div class="alert error" id="modal-error" hidden></div>
    <div class="field"><label>Markt / Shop</label><select id="l-store">${storeOpts}</select></div>
    <div class="field"><label>Link zur Produktseite</label>
      <div class="inline"><input id="l-url" type="url" placeholder="https://www.baumarkt.de/p/…">
      <button type="button" class="btn ghost" id="l-fetch">Abrufen</button></div>
      <div class="hint">Name, Bild, Preis und Versand werden – wenn möglich – automatisch ausgelesen.</div></div>
    <div id="l-preview"></div>
    <div class="field"><label>Produkt</label><select id="l-product">${prodOpts}</select>
      <div class="hint">Gleiches Produkt in mehreren Märkten? Wähle das bestehende Produkt, dann werden die Preise verglichen.</div></div>
    <div class="row">
      <div class="field" id="g-name"><label>Produktname</label><input id="l-name" placeholder="z. B. Spax Schrauben 4×40, 200 Stück"></div>
      <div class="field"><label>Menge</label><input id="l-qty" type="number" min="1" value="${productId ? productById(productId).quantity : 1}"></div>
    </div>
    <div class="row">
      <div class="field"><label>Stückpreis (€)</label><input id="l-price" inputmode="decimal" placeholder="wird ausgelesen"></div>
      <div class="field" id="g-lship"><label>Versand für diesen Artikel (€)</label><input id="l-ship" inputmode="decimal" placeholder="Standard des Shops"></div>
    </div>
    <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Abbrechen</button>
      <button type="submit" class="btn">Hinzufügen</button></div></div>`, async () => {
    const body = {
      store_id: $("#l-store").value, url: $("#l-url").value, product_id: $("#l-product").value || null,
      name: $("#l-name").value, quantity: $("#l-qty").value,
      unit_price: $("#l-price").value, shipping: $("#l-ship").value,
      manual_price: scraped.price == null && $("#l-price").value !== "",
      manual_shipping: scraped.shipping == null && $("#l-ship").value !== "",
      image: scraped.image || "", gtin: scraped.gtin || "", availability: scraped.availability,
    };
    if (body.unit_price && scraped.price != null && scraper_num(body.unit_price) !== scraped.price) body.manual_price = true;
    await mutate("POST", "offers", body);
    closeModal(); toast("Link hinzugefügt"); view = "liste"; render();
  });
  const sync = () => {
    const sid = $("#l-store").value, s = storeById(sid);
    $("#g-lship").hidden = s?.kind === "markt";
    $("#g-name").hidden = !!$("#l-product").value;
  };
  $("#l-store").onchange = sync; $("#l-product").onchange = () => {
    const p = productById($("#l-product").value);
    if (p) $("#l-qty").value = p.quantity;
    sync();
  };
  sync();
  const doFetch = async () => {
    const url = $("#l-url").value.trim();
    if (!url) return;
    $("#modal-error").hidden = true;
    $("#l-preview").innerHTML = `<div class="alert info"><span class="spinner"></span> Seite wird gelesen …</div>`;
    try {
      scraped = await api("POST", "preview", { url });
      $("#l-preview").innerHTML = `<div class="preview">${thumb(scraped.name, scraped.image)}
        <div><strong>${esc(scraped.name || "Unbekanntes Produkt")}</strong>
        <div class="sub">${scraped.price != null ? euro(scraped.price) : "Preis nicht gefunden"}
          ${scraped.shipping != null ? " · Versand " + euro(scraped.shipping) : ""}
          ${scraped.gtin ? " · EAN " + esc(scraped.gtin) : ""}</div>
        ${scraped.match_product_id ? `<div class="sub" style="color:var(--good)">✓ Passt zu einem vorhandenen Produkt</div>` : ""}</div></div>`;
      if (scraped.name && !$("#l-name").value) $("#l-name").value = scraped.name;
      if (scraped.price != null) $("#l-price").value = numIn(scraped.price);
      if (scraped.shipping != null) $("#l-ship").value = numIn(scraped.shipping);
      if (scraped.match_product_id && !$("#l-product").value) {
        $("#l-product").value = scraped.match_product_id; $("#l-product").onchange();
      }
    } catch (e) {
      scraped = {};
      $("#l-preview").innerHTML = "";
      showError(e.message);
    }
  };
  $("#l-fetch").onclick = doFetch;
  $("#l-url").onchange = doFetch;
}

const scraper_num = (v) => { const n = parseFloat(String(v).replace(/\./g, "").replace(",", ".")); return isNaN(n) ? null : n; };

function openOfferForm(offerId) {
  const p = state.products.find((x) => x.offers.some((o) => o.id === offerId));
  const o = p.offers.find((x) => x.id === offerId), s = storeById(o.store_id);
  openModal(`Preis bei ${s.name}`, `<div class="form">
    <div class="alert error" id="modal-error" hidden></div>
    ${o.error ? `<div class="alert info">⚠ ${esc(o.error)}</div>` : ""}
    <div class="field"><label>Link</label><input id="o-url" value="${esc(o.url)}"></div>
    <div class="row">
      <div class="field"><label>Stückpreis (€)</label><input id="o-price" inputmode="decimal" value="${numIn(o.unit_price)}">
        <div class="hint">Leer lassen = automatisch auslesen.</div></div>
      ${s.kind !== "markt" ? `<div class="field"><label>Versand (€)</label><input id="o-ship" inputmode="decimal" value="${numIn(o.shipping)}">
        <div class="hint">Leer = Standard des Shops (${s.shipping_cost == null ? "unbekannt" : euro(s.shipping_cost)}).</div></div>` : ""}
    </div>
    <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Abbrechen</button>
      <button type="submit" class="btn">Speichern</button></div></div>`, async () => {
    const body = { url: $("#o-url").value, unit_price: $("#o-price").value };
    if ($("#o-ship")) body.shipping = $("#o-ship").value;
    await mutate("PUT", "offers/" + offerId, body);
    closeModal();
  });
}

function openProductForm(pid) {
  const p = productById(pid);
  openModal("Produkt bearbeiten", `<div class="form">
    <div class="alert error" id="modal-error" hidden></div>
    <div class="field"><label>Name</label><input id="p-name" value="${esc(p.name)}"></div>
    <div class="row">
      <div class="field"><label>Menge</label><input id="p-qty" type="number" min="1" value="${p.quantity}"></div>
      <div class="field"><label>EAN / GTIN</label><input id="p-gtin" value="${esc(p.gtin)}" placeholder="hilft beim Vergleich"></div>
    </div>
    <div class="field"><label>🎯 Wunschpreis pro Stück (€)</label><input id="p-target" inputmode="decimal" value="${numIn(p.target_price)}" placeholder="optional">
      <div class="hint">Du wirst benachrichtigt, sobald der günstigste Preis pro Stück darunter fällt.</div></div>
    <div class="field"><label>Bild-Adresse</label><input id="p-image" value="${esc(p.image)}" placeholder="https://…"></div>
    <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Abbrechen</button>
      <button type="submit" class="btn">Speichern</button></div></div>`, async () => {
    await mutate("PUT", "products/" + pid, {
      name: $("#p-name").value, quantity: $("#p-qty").value, gtin: $("#p-gtin").value,
      target_price: $("#p-target").value, image: $("#p-image").value,
    });
    closeModal();
  });
}

async function openCompare(pid) {
  const p = productById(pid);
  openModal("Im Internet vergleichen", `<div class="alert info"><span class="spinner"></span>
    Suche „${esc(p.gtin || p.name)}“ in deinen Shops … das kann etwas dauern.</div>`);
  let r;
  try { r = await api("POST", `products/${pid}/compare`); }
  catch (e) { $("#modal-body").innerHTML = `<div class="alert error">${esc(e.message)}</div>`; return; }
  if (!$("#modal").open) return;
  const sug = r.suggestions.map((x, i) => `<div class="suggestion">${thumb(x.name, x.image)}
      <div><strong>${esc(x.name)}</strong><div class="sub">${esc(x.store_name)} · ${euro(x.price)}
        ${x.shipping != null ? " + " + euro(x.shipping) + " Versand" : ""}
        · ${x.gtin_match ? "✓ gleiche EAN" : Math.round(x.score * 100) + " % ähnlich"}</div>
        <a class="sub" href="${esc(x.url)}" target="_blank" rel="noopener">Seite ansehen ↗</a></div>
      <button type="button" class="btn small" data-take="${i}">Übernehmen</button></div>`).join("");
  $("#modal-body").innerHTML = `
    ${r.searched === 0 ? `<div class="alert info">Bei keinem Markt ist eine Such-Adresse hinterlegt. Trage unter
      <em>Märkte → Bearbeiten</em> eine Such-Adresse ein, dann wird dort automatisch gesucht.</div>` : ""}
    ${sug ? `<h3 style="margin:8px 0 0">Gefundene Angebote</h3>${sug}`
      : r.searched ? `<p class="sub">In deinen Shops wurden keine weiteren passenden Angebote gefunden.</p>` : ""}
    ${r.errors.length ? `<details style="margin-top:10px"><summary class="sub">Hinweise (${r.errors.length})</summary>
      <ul class="sub">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}
    <h3 style="margin:16px 0 6px">Auf Vergleichsportalen suchen</h3>
    <div class="inline" style="flex-wrap:wrap">${r.links.map((l) =>
      `<a class="btn ghost small" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)} ↗</a>`).join("")}</div>
    <p class="sub">Günstigeres Angebot gefunden? Lege den Shop als Markt an und füge den Link mit „+ Weiteren Markt“ hinzu.</p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-cancel>Schließen</button></div>`;
  $$("[data-take]").forEach((b) => (b.onclick = async () => {
    const x = r.suggestions[+b.dataset.take];
    b.disabled = true;
    try {
      await mutate("POST", "offers", { store_id: x.store_id, url: x.url, product_id: pid,
        unit_price: x.price, shipping: x.shipping, image: x.image, gtin: x.gtin });
      b.textContent = "✓ Übernommen";
    } catch (e) { b.disabled = false; toast(e.message); }
  }));
}

// ---------------------------------------------------------------- Start

$$(".tab").forEach((t) => (t.onclick = () => { view = t.dataset.view; render(); }));
$("#modal-close").onclick = closeModal;
$("#modal").addEventListener("click", (e) => {
  if (e.target.matches("[data-cancel]")) closeModal();
  if (e.target === $("#modal")) closeModal();
});
$("#modal-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!modalSubmit) return;
  const btn = $("button[type=submit]", e.target);
  if (btn) btn.disabled = true;
  try { await modalSubmit(); } catch (err) { showError(err.message); }
  finally { if (btn) btn.disabled = false; }
});
$("#btn-bell").onclick = async (e) => {
  e.stopPropagation();
  const panel = $("#notif-panel");
  panel.hidden = !panel.hidden;
  if (!panel.hidden && state.unread) {
    await api("POST", "notifications/read");
    setTimeout(load, 1500);
  }
};
document.addEventListener("click", (e) => {
  if (!e.target.closest("#notif-panel")) $("#notif-panel").hidden = true;
});
$("#btn-clear-notif").onclick = () => mutate("DELETE", "notifications");
$("#btn-check").onclick = async () => {
  const b = $("#btn-check");
  b.disabled = true; b.innerHTML = '<span class="spinner"></span> Prüfe …';
  await api("POST", "check-all").catch((e) => toast(e.message));
  toast("Preise werden im Hintergrund geprüft …");
  setTimeout(async () => { await load(); b.disabled = false; b.textContent = "↻ Preise prüfen"; }, 8000);
};

load();
setInterval(() => { if (!$("#modal").open) load(); }, 60000);
