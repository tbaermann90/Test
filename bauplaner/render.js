// Zeichnet aus einem Bauplan (JSON) saubere SVG-Grafiken:
// 3D-Ansicht (isometrisch), Bauteilzeichnungen und Zuschnittpläne.
// Alle Maße sind in Millimetern. Koordinatensystem des Möbels:
// x = Breite (nach rechts), y = Tiefe (nach hinten), z = Höhe (nach oben).

(function () {
  "use strict";

  const C = Math.cos(Math.PI / 6);
  const S = 0.5;
  const EPS = 0.5;
  const SAEGESCHNITT = 4; // mm Verlust pro Schnitt

  const HOLZFARBEN = {
    platte: ["#ecd9b0", "#e6cfa0", "#f0dfbd"],
    brett: ["#dfb47c", "#d8a96c", "#e5bd8a"],
    leiste: ["#cf9c62", "#c79257", "#d6a66f"],
    kantholz: ["#c08a55", "#b8804b", "#c99560"],
    sonstiges: ["#cfc6b8", "#c4bba9", "#d8d0c3"],
  };
  const AKZENT = "#f2a541";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function zahl(v, nk = 0) {
    const n = Number(v) || 0;
    return n.toLocaleString("de-DE", { maximumFractionDigits: nk });
  }

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const mix = (c) => Math.max(0, Math.min(255, Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f))));
    r = mix(r); g = mix(g); b = mix(b);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function rohmaterialVon(plan, teil) {
    return (plan.rohmaterial || []).find((r) => r.id === teil.rohmaterial_id) || null;
  }

  function holzfarbe(plan, teil, index) {
    const roh = rohmaterialVon(plan, teil);
    const art = roh && HOLZFARBEN[roh.art] ? roh.art : "sonstiges";
    const palette = HOLZFARBEN[art];
    return palette[index % palette.length];
  }

  // ---------- Isometrische 3D-Ansicht ----------

  function proj(x, y, z) {
    return [(x + y) * C, -(z + (y - x) * S)];
  }

  function boxEcken(b) {
    const xs = [b.x, b.x + b.dx], ys = [b.y, b.y + b.dy], zs = [b.z, b.z + b.dz];
    const pts = [];
    for (const x of xs) for (const y of ys) for (const z of zs) pts.push(proj(x, y, z));
    return pts;
  }

  // true, wenn Box a hinter Box b liegt (Betrachter vorne rechts oben)
  function liegtHinter(a, b) {
    if (a.x + a.dx <= b.x + EPS) return true;
    if (b.x + b.dx <= a.x + EPS) return false;
    if (a.y >= b.y + b.dy - EPS) return true;
    if (b.y >= a.y + a.dy - EPS) return false;
    if (a.z + a.dz <= b.z + EPS) return true;
    if (b.z + b.dz <= a.z + EPS) return false;
    return null;
  }

  function tiefe(b) {
    // größer = näher am Betrachter
    return (b.x + b.dx / 2) - (b.y + b.dy / 2) + (b.z + b.dz / 2);
  }

  function sortiereBoxen(boxen) {
    const n = boxen.length;
    const bb = boxen.map((b) => {
      const p = boxEcken(b);
      const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
      return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    });
    const vor = Array.from({ length: n }, () => []); // vor[i] = Boxen, die nach i gezeichnet werden müssen
    const grad = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = bb[i], c = bb[j];
        if (a[1] <= c[0] || c[1] <= a[0] || a[3] <= c[2] || c[3] <= a[2]) continue;
        const r = liegtHinter(boxen[i], boxen[j]);
        if (r === true) { vor[i].push(j); grad[j]++; }
        else if (r === false) { vor[j].push(i); grad[i]++; }
      }
    }
    const reihenfolge = [];
    const fertig = new Array(n).fill(false);
    while (reihenfolge.length < n) {
      let kandidat = -1;
      for (let i = 0; i < n; i++) {
        if (fertig[i] || grad[i] > 0) continue;
        if (kandidat < 0 || tiefe(boxen[i]) < tiefe(boxen[kandidat])) kandidat = i;
      }
      if (kandidat < 0) {
        // Zyklus: die am weitesten hinten liegende Box zuerst
        for (let i = 0; i < n; i++) {
          if (!fertig[i] && (kandidat < 0 || tiefe(boxen[i]) < tiefe(boxen[kandidat]))) kandidat = i;
        }
      }
      fertig[kandidat] = true;
      reihenfolge.push(boxen[kandidat]);
      for (const j of vor[kandidat]) grad[j]--;
    }
    return reihenfolge;
  }

  function sammleBoxen(plan, opt) {
    const boxen = [];
    (plan.bauteile || []).forEach((teil, ti) => {
      (teil.einbau || []).forEach((e, ei) => {
        if (!(e.dx > 0 && e.dy > 0 && e.dz > 0)) return;
        boxen.push({ x: e.x, y: e.y, z: e.z, dx: e.dx, dy: e.dy, dz: e.dz, teil, ti, ei });
      });
    });
    if (opt.explodiert && boxen.length) {
      const g = gesamtBox(boxen);
      const cx = g.x + g.dx / 2, cy = g.y + g.dy / 2, cz = g.z + g.dz / 2;
      for (const b of boxen) {
        const f = 0.55;
        b.x += (b.x + b.dx / 2 - cx) * f;
        b.y += (b.y + b.dy / 2 - cy) * f;
        b.z += (b.z + b.dz / 2 - cz) * f;
      }
    }
    return boxen;
  }

  function gesamtBox(boxen) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const b of boxen) {
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); z0 = Math.min(z0, b.z);
      x1 = Math.max(x1, b.x + b.dx); y1 = Math.max(y1, b.y + b.dy); z1 = Math.max(z1, b.z + b.dz);
    }
    return { x: x0, y: y0, z: z0, dx: x1 - x0, dy: y1 - y0, dz: z1 - z0 };
  }

  /**
   * opt: { breite, explodiert, hervorheben: Set<id>, sichtbar: Set<id>|null,
   *        beschriftung: bool, masse: bool }
   */
  function isoSVG(plan, opt = {}) {
    const breite = opt.breite || 760;
    let boxen = sammleBoxen(plan, opt);
    if (opt.sichtbar) boxen = boxen.filter((b) => opt.sichtbar.has(b.teil.id));
    if (!boxen.length) {
      return `<svg viewBox="0 0 ${breite} 200" class="zeichnung" role="img"><text x="${breite / 2}" y="100" text-anchor="middle" class="z-hinweis">Keine 3D-Daten vorhanden</text></svg>`;
    }
    const alle = sammleBoxen(plan, opt);
    const g = gesamtBox(alle); // Rahmen immer am ganzen Möbel ausrichten, damit Schritte ruhig bleiben
    const ecken = boxEcken(g);
    let minX = Math.min(...ecken.map((p) => p[0])), maxX = Math.max(...ecken.map((p) => p[0]));
    let minY = Math.min(...ecken.map((p) => p[1])), maxY = Math.max(...ecken.map((p) => p[1]));

    const randL = opt.beschriftung ? 100 : opt.masse ? 60 : 40;
    const randR = opt.beschriftung ? 90 : 40;
    const randO = 30, randU = opt.masse ? 70 : 30;
    const nutzB = breite - randL - randR;
    const s = nutzB / Math.max(1, maxX - minX);
    const hoehe = Math.round((maxY - minY) * s + randO + randU);
    const P = (x, y, z) => {
      const p = proj(x, y, z);
      return [randL + (p[0] - minX) * s, randO + (p[1] - minY) * s];
    };
    const pts = (arr) => arr.map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");

    let out = `<svg viewBox="0 0 ${breite} ${hoehe}" class="zeichnung" role="img" aria-label="3D-Ansicht">`;
    out += `<defs><pattern id="schraffur" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#00000018" stroke-width="2"/></pattern></defs>`;

    // Schatten am Boden
    const sb = [P(g.x, g.y, g.z), P(g.x + g.dx, g.y, g.z), P(g.x + g.dx, g.y + g.dy, g.z), P(g.x, g.y + g.dy, g.z)];
    out += `<polygon points="${pts(sb)}" fill="#00000010" stroke="none"/>`;

    const hervor = opt.hervorheben || null;
    for (const b of sortiereBoxen(boxen)) {
      const x0 = b.x, x1 = b.x + b.dx, y0 = b.y, y1 = b.y + b.dy, z0 = b.z, z1 = b.z + b.dz;
      let basis = holzfarbe(plan, b.teil, b.ti);
      if (hervor && hervor.size) {
        if (hervor.has(b.teil.id)) basis = AKZENT;
        else basis = shade(basis, 0.5);
      }
      const oben = [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)];
      const vorne = [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)];
      const rechts = [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)];
      const linie = hervor && hervor.size && !hervor.has(b.teil.id) ? "#8a7a66" : "#3b2f22";
      out += `<g class="box" data-teil="${esc(b.teil.id)}" stroke="${linie}" stroke-width="1.1" stroke-linejoin="round">`;
      out += `<polygon points="${pts(vorne)}" fill="${basis}"/>`;
      out += `<polygon points="${pts(rechts)}" fill="${shade(basis, -0.18)}"/>`;
      out += `<polygon points="${pts(oben)}" fill="${shade(basis, 0.28)}"/>`;
      out += `</g>`;
    }

    if (opt.masse && !opt.explodiert) {
      out += isoMass(P, [g.x, g.y, g.z], [g.x + g.dx, g.y, g.z], [0, -1, 0], g, s, `${zahl(g.dx)} mm`, "Breite");
      out += isoMass(P, [g.x + g.dx, g.y, g.z], [g.x + g.dx, g.y + g.dy, g.z], [1, 0, 0], g, s, `${zahl(g.dy)} mm`, "Tiefe");
      out += isoMass(P, [g.x, g.y, g.z], [g.x, g.y, g.z + g.dz], [-1, 0, 0], g, s, `${zahl(g.dz)} mm`, "Höhe");
    }

    if (opt.beschriftung) out += beschriftungen(plan, boxen, P, breite, hoehe, randL, randR);
    out += `</svg>`;
    return out;
  }

  function isoMass(P, a, b, richtung, g, s, text) {
    const abstand = 26 / s + Math.max(g.dx, g.dy, g.dz) * 0.03;
    const off = (p, f) => [p[0] + richtung[0] * abstand * f, p[1] + richtung[1] * abstand * f, p[2] + richtung[2] * abstand * f];
    const a1 = P(...off(a, 0.25)), b1 = P(...off(b, 0.25));
    const a2 = P(...off(a, 1)), b2 = P(...off(b, 1));
    const a3 = P(...off(a, 1.15)), b3 = P(...off(b, 1.15));
    const mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2;
    let winkel = (Math.atan2(b2[1] - a2[1], b2[0] - a2[0]) * 180) / Math.PI;
    if (winkel > 90) winkel -= 180;
    if (winkel < -90) winkel += 180;
    const len = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]) || 1;
    const nx = (b2[0] - a2[0]) / len, ny = (b2[1] - a2[1]) / len;
    const t = 6;
    let o = `<g class="masslinie">`;
    o += `<line x1="${a1[0]}" y1="${a1[1]}" x2="${a3[0]}" y2="${a3[1]}"/>`;
    o += `<line x1="${b1[0]}" y1="${b1[1]}" x2="${b3[0]}" y2="${b3[1]}"/>`;
    o += `<line x1="${a2[0]}" y1="${a2[1]}" x2="${b2[0]}" y2="${b2[1]}"/>`;
    o += `<path d="M${a2[0]},${a2[1]} l${(nx * 9 + ny * 3.5).toFixed(1)},${(ny * 9 - nx * 3.5).toFixed(1)} l${(-ny * 7).toFixed(1)},${(nx * 7).toFixed(1)}z" class="pfeil"/>`;
    o += `<path d="M${b2[0]},${b2[1]} l${(-nx * 9 + ny * 3.5).toFixed(1)},${(-ny * 9 - nx * 3.5).toFixed(1)} l${(-ny * 7).toFixed(1)},${(nx * 7).toFixed(1)}z" class="pfeil"/>`;
    o += `<text x="${mx}" y="${my - t}" transform="rotate(${winkel.toFixed(1)} ${mx} ${my})" text-anchor="middle" class="z-mass">${esc(text)}</text>`;
    o += `</g>`;
    return o;
  }

  function beschriftungen(plan, boxen, P, breite, hoehe, randL, randR) {
    // Pro Teil das Exemplar beschriften, das dem Betrachter am nächsten ist
    const naechste = new Map();
    for (const b of boxen) {
      const alt = naechste.get(b.teil.id);
      if (!alt || tiefe(b) > tiefe(alt)) naechste.set(b.teil.id, b);
    }
    const anker = [...naechste.values()].map((b) => ({ id: b.teil.id, p: P(b.x + b.dx / 2, b.y + b.dy / 2, b.z + b.dz / 2) }));
    const mitte = breite / 2;
    const links = anker.filter((a) => a.p[0] < mitte).sort((a, b) => a.p[1] - b.p[1]);
    const rechts = anker.filter((a) => a.p[0] >= mitte).sort((a, b) => a.p[1] - b.p[1]);
    const verteilen = (liste) => {
      let letzte = -Infinity;
      for (const a of liste) {
        a.y = Math.max(a.p[1], letzte + 28);
        letzte = a.y;
      }
      const ueber = letzte - (hoehe - 16);
      if (ueber > 0) for (const a of liste) a.y -= ueber;
      for (const a of liste) a.y = Math.max(16, a.y);
    };
    verteilen(links);
    verteilen(rechts);
    let o = `<g class="beschriftung">`;
    const zeichne = (a, x) => {
      o += `<line x1="${a.p[0]}" y1="${a.p[1]}" x2="${x}" y2="${a.y}"/>`;
      o += `<circle cx="${a.p[0]}" cy="${a.p[1]}" r="2.5" class="punkt"/>`;
      o += `<circle cx="${x}" cy="${a.y}" r="12" class="blase"/>`;
      o += `<text x="${x}" y="${a.y + 4.5}" text-anchor="middle">${esc(a.id)}</text>`;
    };
    for (const a of links) zeichne(a, randL / 2);
    for (const a of rechts) zeichne(a, breite - randR / 2);
    o += `</g>`;
    return o;
  }

  // ---------- Bauteilzeichnung (Draufsicht + Seitenansicht) ----------

  function bauteilSVG(plan, teil) {
    const L = Math.max(1, Number(teil.laenge) || 1);
    const B = Math.max(1, Number(teil.breite) || 1);
    const T = Math.max(1, Number(teil.staerke) || 1);
    const W = 700;
    const randL = 70, randR = 50, randO = 54;
    const nutzB = W - randL - randR;
    const s = nutzB / L;
    let hB = B * s, hT = T * s;
    const verzerrt = hB < 40 || hT < 8 || hB > 320;
    if (hB < 40) hB = 40;
    if (hB > 320) hB = 320;
    if (hT < 8) hT = 8;
    const sy = hB / B; // Maßstab quer
    const sT = hT / T;

    const ops = (teil.bearbeitungen || []).filter((b) => b && b.art);
    const lochX = [...new Set(ops.filter(istLoch).map((b) => Math.round(b.x)))].sort((a, b) => a - b);
    const lochY = [...new Set(ops.filter(istLoch).map((b) => Math.round(b.y)))].sort((a, b) => a - b);

    const x0 = randL, y0 = randO;
    const ketteU = lochX.length ? 34 : 0;
    const yS = y0 + hB + 30 + ketteU; // Seitenansicht
    const H = Math.round(yS + hT + 46);
    const farbe = holzfarbe(plan, teil, 0);

    let o = `<svg viewBox="0 0 ${W} ${H}" class="zeichnung" role="img" aria-label="Bauteil ${esc(teil.id)}">`;
    o += `<defs><pattern id="nut-${esc(teil.id)}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#5b4a36" stroke-width="1"/></pattern></defs>`;
    o += `<text x="${x0}" y="20" class="z-titel">Draufsicht</text>`;
    o += `<rect x="${x0}" y="${y0}" width="${nutzB}" height="${hB}" fill="${farbe}" class="teil"/>`;

    // Maserung andeuten
    if (teil.maserung_wichtig !== false) {
      for (let i = 1; i < 4; i++) {
        const yy = y0 + (hB * i) / 4;
        o += `<path d="M${x0 + 8},${yy} C${x0 + nutzB * 0.3},${yy - 4} ${x0 + nutzB * 0.6},${yy + 4} ${x0 + nutzB - 8},${yy}" class="maserung"/>`;
      }
    }

    for (const b of ops) {
      const bx = x0 + (Number(b.x) || 0) * s;
      const by = y0 + hB - (Number(b.y) || 0) * sy;
      if (istLoch(b)) {
        const r = Math.max(3, ((Number(b.durchmesser) || 8) * s) / 2);
        o += `<circle cx="${bx}" cy="${by}" r="${r}" class="loch"/>`;
        o += `<line x1="${bx - r - 4}" y1="${by}" x2="${bx + r + 4}" y2="${by}" class="mittellinie"/>`;
        o += `<line x1="${bx}" y1="${by - r - 4}" x2="${bx}" y2="${by + r + 4}" class="mittellinie"/>`;
        if (b.art === "senkbohrung") o += `<circle cx="${bx}" cy="${by}" r="${r + 3}" class="loch-senk"/>`;
        if (b.art === "taschenloch") o += `<path d="M${bx - r},${by + r * 2.2} L${bx},${by} L${bx + r},${by + r * 2.2}" class="loch-senk"/>`;
      } else {
        const bw = Math.max(2, (Number(b.l) || L) * s);
        const bh = Math.max(2, (Number(b.b) || 10) * sy);
        const art = b.art === "ausschnitt" ? "ausschnitt" : "nut";
        o += `<rect x="${bx}" y="${by - bh}" width="${bw}" height="${bh}" class="${art}" fill="url(#nut-${esc(teil.id)})"/>`;
      }
    }

    // Maßlinien Länge (oben) und Breite (links)
    o += massH(x0, x0 + nutzB, y0 - 18, y0, `${zahl(L)}`);
    o += massV(y0, y0 + hB, x0 - 22, x0, `${zahl(B)}`);

    // Bezugsmaße für Bohrungen: gemessen von der linken bzw. unteren Kante
    if (lochX.length) {
      const yk = y0 + hB + 8;
      o += `<g class="masslinie klein"><line x1="${x0}" y1="${yk}" x2="${x0 + lochX[lochX.length - 1] * s}" y2="${yk}"/>`;
      o += `<circle cx="${x0}" cy="${yk}" r="2.5" class="pfeil"/>`;
      for (const v of lochX) {
        const xx = x0 + v * s;
        o += `<line x1="${xx}" y1="${yk - 3}" x2="${xx}" y2="${yk + 3}"/>`;
        o += `<text x="${xx + 3}" y="${yk + 6}" transform="rotate(-90 ${xx + 3} ${yk + 6})" text-anchor="end" class="z-mass klein">${zahl(v)}</text>`;
      }
      o += `</g>`;
    }
    if (lochY.length) {
      const xk = x0 + nutzB + 8;
      o += `<g class="masslinie klein"><line x1="${xk}" y1="${y0 + hB}" x2="${xk}" y2="${y0 + hB - lochY[lochY.length - 1] * sy}"/>`;
      o += `<circle cx="${xk}" cy="${y0 + hB}" r="2.5" class="pfeil"/>`;
      for (const v of lochY) {
        const yy = y0 + hB - v * sy;
        o += `<line x1="${xk - 3}" y1="${yy}" x2="${xk + 3}" y2="${yy}"/>`;
        o += `<text x="${xk + 5}" y="${yy + 3.5}" class="z-mass klein">${zahl(v)}</text>`;
      }
      o += `</g>`;
    }

    // Seitenansicht (Stärke)
    o += `<text x="${x0}" y="${yS - 12}" class="z-titel">Seitenansicht</text>`;
    o += `<rect x="${x0}" y="${yS}" width="${nutzB}" height="${hT}" fill="${shade(farbe, -0.1)}" class="teil"/>`;
    o += massV(yS, yS + hT, x0 - 22, x0, `${zahl(T)}`);
    for (const b of ops) {
      if (!istLoch(b) || !(Number(b.tiefe) > 0)) continue;
      const bx = x0 + (Number(b.x) || 0) * s;
      const r = Math.max(2, ((Number(b.durchmesser) || 8) * s) / 2);
      const t = Math.min(hT, (Number(b.tiefe) || T) * sT);
      o += `<rect x="${bx - r}" y="${yS}" width="${2 * r}" height="${t}" class="loch-verdeckt"/>`;
    }

    if (verzerrt) o += `<text x="${W - randR}" y="${H - 10}" text-anchor="end" class="z-hinweis">Darstellung nicht maßstäblich – es gelten die Maßzahlen (mm)</text>`;
    else o += `<text x="${W - randR}" y="${H - 10}" text-anchor="end" class="z-hinweis">Alle Maße in mm</text>`;
    o += `</svg>`;
    return o;
  }

  function istLoch(b) {
    return ["bohrung", "senkbohrung", "taschenloch", "duebelloch", "dübelloch", "sackloch"].includes(String(b.art).toLowerCase());
  }

  function massH(xa, xb, y, yRef, text, klein) {
    let o = `<g class="masslinie${klein ? " klein" : ""}">`;
    o += `<line x1="${xa}" y1="${yRef}" x2="${xa}" y2="${y + (y < yRef ? -4 : 4)}"/>`;
    o += `<line x1="${xb}" y1="${yRef}" x2="${xb}" y2="${y + (y < yRef ? -4 : 4)}"/>`;
    o += `<line x1="${xa}" y1="${y}" x2="${xb}" y2="${y}"/>`;
    o += `<path d="M${xa},${y} l7,-3 v6z M${xb},${y} l-7,-3 v6z" class="pfeil"/>`;
    o += `<text x="${(xa + xb) / 2}" y="${y - 5}" text-anchor="middle" class="z-mass">${esc(text)}</text>`;
    return o + `</g>`;
  }

  function massV(ya, yb, x, xRef, text, klein) {
    let o = `<g class="masslinie${klein ? " klein" : ""}">`;
    const ende = x + (x < xRef ? -4 : 4);
    o += `<line x1="${xRef}" y1="${ya}" x2="${ende}" y2="${ya}"/>`;
    o += `<line x1="${xRef}" y1="${yb}" x2="${ende}" y2="${yb}"/>`;
    o += `<line x1="${x}" y1="${ya}" x2="${x}" y2="${yb}"/>`;
    o += `<path d="M${x},${ya} l-3,7 h6z M${x},${yb} l-3,-7 h6z" class="pfeil"/>`;
    const my = (ya + yb) / 2;
    const tx = x < xRef ? x - 5 : x + 13;
    o += `<text x="${tx}" y="${my}" transform="rotate(-90 ${tx} ${my})" text-anchor="middle" class="z-mass">${esc(text)}</text>`;
    return o + `</g>`;
  }

  // ---------- Zuschnitt ----------

  function zuschnitt(plan) {
    const ergebnis = [];
    for (const roh of plan.rohmaterial || []) {
      const teile = [];
      for (const t of plan.bauteile || []) {
        if (t.rohmaterial_id !== roh.id) continue;
        const n = Math.max(1, Math.round(Number(t.anzahl) || 1));
        for (let i = 0; i < n; i++) {
          teile.push({ id: t.id, name: t.name, l: Number(t.laenge) || 0, b: Number(t.breite) || 0, drehbar: roh.art === "platte" && !t.maserung_wichtig });
        }
      }
      if (!teile.length) continue;
      const RL = Number(roh.laenge) || 0, RB = Number(roh.breite) || 0;
      const zuGross = [];
      const passend = [];
      for (const t of teile) {
        const passtNormal = t.l <= RL && t.b <= RB;
        const passtGedreht = t.drehbar && t.b <= RL && t.l <= RB;
        if (!passtNormal && passtGedreht) { const l = t.l; t.l = t.b; t.b = l; t.gedreht = true; }
        if (passtNormal || passtGedreht) passend.push(t); else zuGross.push(t);
      }
      ergebnis.push({ roh, stuecke: packen(passend, RL, RB), zuGross });
    }
    return ergebnis;
  }

  // Einfache Regal-Packung: Streifen quer zur Länge, darin Teile hintereinander.
  function packen(teile, RL, RB) {
    const sortiert = teile.slice().sort((a, b) => b.b - a.b || b.l - a.l);
    const stuecke = [];
    for (const t of sortiert) {
      let platziert = false;
      for (const st of stuecke) {
        for (const r of st.reihen) {
          if (t.b <= r.h && r.x + t.l <= RL) {
            st.teile.push({ ...t, x: r.x, y: r.y });
            r.x += t.l + SAEGESCHNITT;
            platziert = true;
            break;
          }
        }
        if (platziert) break;
        if (st.belegtB + t.b <= RB) {
          const r = { y: st.belegtB, h: t.b, x: t.l + SAEGESCHNITT };
          st.reihen.push(r);
          st.teile.push({ ...t, x: 0, y: r.y });
          st.belegtB += t.b + SAEGESCHNITT;
          platziert = true;
          break;
        }
      }
      if (!platziert) {
        const st = { reihen: [{ y: 0, h: t.b, x: t.l + SAEGESCHNITT }], teile: [{ ...t, x: 0, y: 0 }], belegtB: t.b + SAEGESCHNITT };
        stuecke.push(st);
      }
    }
    return stuecke;
  }

  function zuschnittSVG(roh, stueck, nr) {
    const RL = Number(roh.laenge) || 1, RB = Number(roh.breite) || 1;
    const W = 700, rand = 40;
    const s = (W - rand * 2) / RL;
    let h = RB * s;
    const sy = h < 34 ? 34 / RB : s;
    h = RB * sy;
    const H = Math.round(h + 70);
    const y0 = 34;
    let o = `<svg viewBox="0 0 ${W} ${H}" class="zeichnung" role="img" aria-label="Zuschnitt ${esc(roh.name)} ${nr}">`;
    o += `<defs><pattern id="rest" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#00000022" stroke-width="2"/></pattern></defs>`;
    o += `<text x="${rand}" y="20" class="z-titel">${esc(roh.name)} · Stück ${nr} · ${zahl(RL)} × ${zahl(RB)} × ${zahl(roh.staerke)} mm</text>`;
    o += `<rect x="${rand}" y="${y0}" width="${RL * s}" height="${h}" fill="url(#rest)" class="rohteil"/>`;
    let flaeche = 0;
    for (const t of stueck.teile) {
      const x = rand + t.x * s, y = y0 + t.y * sy, w = t.l * s, hh = t.b * sy;
      flaeche += t.l * t.b;
      o += `<rect x="${x}" y="${y}" width="${w}" height="${hh}" class="zuschnitt-teil"/>`;
      const gross = w > 60 && hh > 26;
      if (w > 22) {
        o += `<text x="${x + w / 2}" y="${y + hh / 2 + (gross ? -2 : 4)}" text-anchor="middle" class="z-teil-id">${esc(t.id)}</text>`;
        if (gross) o += `<text x="${x + w / 2}" y="${y + hh / 2 + 13}" text-anchor="middle" class="z-teil-mass">${zahl(t.l)} × ${zahl(t.b)}${t.gedreht ? " ↻" : ""}</text>`;
      }
    }
    const nutzung = Math.round((flaeche / (RL * RB)) * 100);
    o += `<text x="${rand}" y="${y0 + h + 22}" class="z-hinweis">Ausnutzung ca. ${nutzung} % · Sägeschnitt ${SAEGESCHNITT} mm berücksichtigt · schraffiert = Reststück</text>`;
    o += `</svg>`;
    return o;
  }

  window.Zeichnen = { isoSVG, bauteilSVG, zuschnitt, zuschnittSVG, esc, zahl };
})();
