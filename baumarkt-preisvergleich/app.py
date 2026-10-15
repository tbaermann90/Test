"""Baumarkt-Preisvergleich – lokaler Server.

Starten mit:  python3 app.py
Danach öffnet sich die Oberfläche unter http://127.0.0.1:8765 im Browser.
Alle Daten liegen in der Datei daten.json neben diesem Skript.
"""

import json
import mimetypes
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pricing
import scraper

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_FILE = os.environ.get("BAUMARKT_DATEN", os.path.join(BASE_DIR, "daten.json"))
HOST = os.environ.get("BAUMARKT_HOST", "127.0.0.1")
PORT = int(os.environ.get("BAUMARKT_PORT", "8765"))

DEFAULT_SETTINGS = {
    "home": {"address": "", "lat": None, "lon": None},
    "radius_km": 15,
    "check_interval_hours": 6,
    "last_full_check": None,
}

# Allgemeine Preisvergleichs-Seiten für die schnelle Suche per Klick.
COMPARE_SITES = [
    ("idealo", "https://www.idealo.de/preisvergleich/MainSearchProductCategory.html?q={q}"),
    ("Google Shopping", "https://www.google.com/search?tbm=shop&q={q}"),
    ("billiger.de", "https://www.billiger.de/search?searchstring={q}"),
]


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def new_id():
    return uuid.uuid4().hex[:10]


# --------------------------------------------------------------------------
# Datenhaltung
# --------------------------------------------------------------------------

class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.RLock()
        self.data = self._load()

    def _load(self):
        data = {}
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                data = json.load(f)
        data.setdefault("settings", {})
        for k, v in DEFAULT_SETTINGS.items():
            data["settings"].setdefault(k, v)
        for key in ("stores", "products", "offers", "notifications"):
            data.setdefault(key, [])
        return data

    def save(self):
        with self.lock:
            tmp = self.path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)

    def find(self, kind, item_id):
        return next((x for x in self.data[kind] if x["id"] == item_id), None)


db = None


def notify(kind, text, product_id=None):
    db.data["notifications"].insert(0, {
        "id": new_id(), "kind": kind, "text": text, "product_id": product_id,
        "created": now_iso(), "read": False,
    })
    del db.data["notifications"][200:]


def euro(v):
    return f"{v:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


# --------------------------------------------------------------------------
# Zustand für die Oberfläche
# --------------------------------------------------------------------------

def build_state():
    with db.lock:
        d = db.data
        settings = d["settings"]
        stores_by_id = {s["id"]: s for s in d["stores"]}
        stores = []
        for s in d["stores"]:
            dist = pricing.store_distance(s, settings)
            stores.append({**s, "distance_km": dist,
                           "in_radius": dist is None or dist <= settings["radius_km"]})
        products, grand_total = [], 0.0
        for p in d["products"]:
            offers = [o for o in d["offers"] if o["product_id"] == p["id"]]
            ev = pricing.evaluate_product(p, offers, stores_by_id, settings)
            if ev["best"]:
                grand_total += ev["best"]["total"]
            products.append({**p, "offers": offers, "evaluation": ev})
        return {
            "settings": settings,
            "stores": stores,
            "products": products,
            "grand_total": round(grand_total, 2),
            "notifications": d["notifications"][:50],
            "unread": sum(1 for n in d["notifications"] if not n["read"]),
        }


def best_offer_id(product_id):
    p = db.find("products", product_id)
    if not p:
        return None
    offers = [o for o in db.data["offers"] if o["product_id"] == product_id]
    stores_by_id = {s["id"]: s for s in db.data["stores"]}
    ev = pricing.evaluate_product(p, offers, stores_by_id, db.data["settings"])
    return ev["best"]


# --------------------------------------------------------------------------
# Preise abrufen und Benachrichtigungen
# --------------------------------------------------------------------------

def apply_scrape(offer, info):
    """Übernimmt neue Daten in ein Angebot. Gibt den alten Preis zurück."""
    old = offer.get("unit_price")
    if info.get("price") is not None and not offer.get("manual_price"):
        offer["unit_price"] = info["price"]
    if info.get("shipping") is not None and not offer.get("manual_shipping"):
        offer["shipping"] = info["shipping"]
    offer["availability"] = info.get("availability")
    offer["last_checked"] = now_iso()
    offer["error"] = None
    if offer.get("unit_price") is not None:
        hist = offer.setdefault("history", [])
        if not hist or hist[-1]["price"] != offer["unit_price"]:
            hist.append({"date": now_iso(), "price": offer["unit_price"]})
            del hist[:-30]
    return old


def refresh_offer(offer_id):
    with db.lock:
        offer = db.find("offers", offer_id)
        if not offer:
            return
        url = offer["url"]
        before_best = best_offer_id(offer["product_id"])
    try:
        info = scraper.scrape(url)
    except scraper.ScrapeError as e:
        with db.lock:
            offer["error"] = str(e)
            offer["last_checked"] = now_iso()
        return
    with db.lock:
        old = apply_scrape(offer, info)
        new = offer.get("unit_price")
        product = db.find("products", offer["product_id"])
        store = db.find("stores", offer["store_id"])
        if product and store and old is not None and new is not None and new < old:
            pct = round((old - new) / old * 100)
            notify("angebot",
                   f"Angebot: {product['name']} bei {store['name']} jetzt {euro(new)} "
                   f"statt {euro(old)} (−{pct} %)", product["id"])
        if product:
            check_product_alerts(product, before_best)


def check_product_alerts(product, before_best):
    after = best_offer_id(product["id"])
    if not after:
        return
    if before_best and before_best["offer_id"] != after["offer_id"]:
        store = db.find("stores", db.find("offers", after["offer_id"])["store_id"])
        way = "Abholung" if after["type"] == pricing.PICKUP else "Lieferung"
        notify("bestpreis",
               f"Neuer Bestpreis für {product['name']}: {euro(after['total'])} "
               f"bei {store['name']} ({way})", product["id"])
    target = product.get("target_price")
    if target:
        unit = after["total"] / max(1, int(product.get("quantity") or 1))
        if unit <= target and not product.get("target_notified"):
            notify("wunschpreis",
                   f"Wunschpreis erreicht: {product['name']} für {euro(unit)} pro Stück",
                   product["id"])
            product["target_notified"] = True
        elif unit > target:
            product["target_notified"] = False


def check_all():
    with db.lock:
        ids = [o["id"] for o in db.data["offers"]]
    for oid in ids:
        refresh_offer(oid)
        time.sleep(1.5)  # Shops nicht mit Anfragen überhäufen
    with db.lock:
        db.data["settings"]["last_full_check"] = now_iso()
        db.save()


def background_checker():
    while True:
        try:
            s = db.data["settings"]
            hours = float(s.get("check_interval_hours") or 0)
            last = s.get("last_full_check")
            due = hours > 0 and (
                not last or (datetime.now() - datetime.fromisoformat(last)).total_seconds()
                >= hours * 3600)
            if due and db.data["offers"]:
                check_all()
        except Exception as e:  # noqa: BLE001 - Thread darf nie sterben
            print("Fehler bei der Preisprüfung:", e, file=sys.stderr)
        time.sleep(60)


# --------------------------------------------------------------------------
# Internet-Vergleich
# --------------------------------------------------------------------------

def compare_product(product_id):
    """Sucht in den Shops mit hinterlegter Such-Adresse nach dem Produkt."""
    with db.lock:
        product = db.find("products", product_id)
        if not product:
            raise ValueError("Produkt nicht gefunden")
        known_urls = {o["url"] for o in db.data["offers"]}
        stores = [dict(s) for s in db.data["stores"] if s.get("search_url")]
        query = product.get("gtin") or product["name"]
    suggestions, errors = [], []
    for s in stores:
        url = s["search_url"].replace("{suche}", urllib.parse.quote_plus(query)) \
                             .replace("{q}", urllib.parse.quote_plus(query))
        try:
            html, final_url = scraper.fetch(url)
        except scraper.ScrapeError as e:
            errors.append(f"{s['name']}: {e}")
            continue
        # Manche Shops leiten bei eindeutiger EAN direkt auf die Produktseite.
        direct = scraper.extract(html, final_url)
        candidates = []
        if direct["price"] is not None and direct["name"]:
            direct["url"] = direct["url"] or final_url
            candidates.append(direct)
        found, links = scraper.extract_listing(html, final_url)
        candidates += [p for p in found if p["price"] is not None]
        for link in links[:3]:
            if len(candidates) >= 5:
                break
            try:
                info = scraper.scrape(link)
                info["url"] = info["url"] or link
                candidates.append(info)
            except scraper.ScrapeError:
                pass
        for c in candidates:
            if not c.get("url") or c["url"] in known_urls:
                continue
            gtin_match = bool(product.get("gtin") and c.get("gtin") == product["gtin"])
            score = 1.0 if gtin_match else scraper.similarity(product["name"], c["name"])
            if score >= 0.55:
                suggestions.append({**c, "store_id": s["id"], "store_name": s["name"],
                                    "score": round(score, 2), "gtin_match": gtin_match})
                known_urls.add(c["url"])
        if not candidates:
            errors.append(f"{s['name']}: keine Treffer gefunden")
    suggestions.sort(key=lambda x: (-x["score"], x["price"] or 0))
    q = urllib.parse.quote_plus(product.get("gtin") or product["name"])
    return {
        "suggestions": suggestions,
        "errors": errors,
        "searched": len(stores),
        "links": [{"name": n, "url": u.format(q=q)} for n, u in COMPARE_SITES],
    }


def geocode(address):
    url = ("https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de,at,ch&q="
           + urllib.parse.quote(address))
    req = urllib.request.Request(url, headers={"User-Agent": "Baumarkt-Preisvergleich/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            res = json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"Adresse konnte nicht gesucht werden: {e}") from e
    if not res:
        raise ValueError("Adresse nicht gefunden. Bitte genauer angeben.")
    return {"lat": float(res[0]["lat"]), "lon": float(res[0]["lon"]),
            "display": res[0].get("display_name")}


# --------------------------------------------------------------------------
# Eingaben prüfen
# --------------------------------------------------------------------------

def num(v, allow_none=True):
    if v in (None, ""):
        if allow_none:
            return None
        raise ValueError("Zahl fehlt")
    n = scraper.parse_price(v)
    if n is None or n < 0:
        raise ValueError(f"Ungültige Zahl: {v}")
    return n


def store_fields(body, store):
    if "name" in body:
        name = (body["name"] or "").strip()
        if not name:
            raise ValueError("Bitte einen Namen für den Markt angeben.")
        store["name"] = name
    if "kind" in body:
        if body["kind"] not in ("markt", "online", "beides"):
            raise ValueError("Unbekannte Art")
        store["kind"] = body["kind"]
    for key in ("address", "search_url"):
        if key in body:
            store[key] = (body[key] or "").strip()
    for key in ("shipping_cost", "free_shipping_from"):
        if key in body:
            store[key] = num(body[key])
    for key in ("lat", "lon"):
        if key in body:
            store[key] = None if body[key] in (None, "") else float(body[key])


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------

class ApiError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


class Handler(BaseHTTPRequestHandler):
    server_version = "Baumarkt/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError as e:
            raise ApiError(400, "Ungültige Anfrage") from e

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith("/api/"):
            return self._api("GET", path)
        if path == "/":
            path = "/index.html"
        file = os.path.normpath(os.path.join(STATIC_DIR, path.lstrip("/")))
        if not file.startswith(STATIC_DIR) or not os.path.isfile(file):
            return self._send(404, b"Nicht gefunden", "text/plain; charset=utf-8")
        ctype = mimetypes.guess_type(file)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        with open(file, "rb") as f:
            self._send(200, f.read(), ctype)

    def do_POST(self):
        self._api("POST", urllib.parse.urlparse(self.path).path)

    def do_PUT(self):
        self._api("PUT", urllib.parse.urlparse(self.path).path)

    def do_DELETE(self):
        self._api("DELETE", urllib.parse.urlparse(self.path).path)

    def _api(self, method, path):
        # Schutz gegen fremde Webseiten, die den lokalen Server ansprechen.
        if method != "GET" and self.headers.get("X-Baumarkt") != "1":
            return self._send(403, {"error": "Nicht erlaubt"})
        try:
            body = self._body() if method in ("POST", "PUT") else {}
            result = route(method, path.rstrip("/"), body)
            self._send(200, result if result is not None else build_state())
        except ApiError as e:
            self._send(e.status, {"error": str(e)})
        except (ValueError, scraper.ScrapeError) as e:
            self._send(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            print("Interner Fehler:", repr(e), file=sys.stderr)
            self._send(500, {"error": f"Interner Fehler: {e}"})


def route(method, path, body):
    parts = path.split("/")[2:]  # ['stores', '<id>', ...]
    res = parts[0] if parts else ""
    item_id = parts[1] if len(parts) > 1 else None
    action = parts[2] if len(parts) > 2 else None

    if method == "GET" and res == "state":
        return build_state()

    if method == "PUT" and res == "settings":
        with db.lock:
            s = db.data["settings"]
            if "address" in body:
                s["home"]["address"] = (body["address"] or "").strip()
            if "lat" in body:
                s["home"]["lat"] = None if body["lat"] in (None, "") else float(body["lat"])
            if "lon" in body:
                s["home"]["lon"] = None if body["lon"] in (None, "") else float(body["lon"])
            if "radius_km" in body:
                s["radius_km"] = num(body["radius_km"], allow_none=False)
            if "check_interval_hours" in body:
                s["check_interval_hours"] = num(body["check_interval_hours"], allow_none=False)
            db.save()
        return None

    if method == "POST" and res == "geocode":
        return geocode((body.get("address") or "").strip())

    if method == "POST" and res == "preview":
        url = (body.get("url") or "").strip()
        info = scraper.scrape(url)
        with db.lock:
            match = None
            for p in db.data["products"]:
                if info.get("gtin") and p.get("gtin") == info["gtin"]:
                    match = p["id"]
                    break
            if not match and info.get("name"):
                scored = [(scraper.similarity(info["name"], p["name"]), p["id"])
                          for p in db.data["products"]]
                scored = [x for x in scored if x[0] >= 0.75]
                if scored:
                    match = max(scored)[1]
        return {**info, "match_product_id": match}

    if res == "stores":
        with db.lock:
            if method == "POST" and not item_id:
                store = {"id": new_id(), "name": "", "kind": "markt", "address": "",
                         "lat": None, "lon": None, "shipping_cost": None,
                         "free_shipping_from": None, "search_url": ""}
                store_fields(body, store)
                if not store["name"]:
                    raise ValueError("Bitte einen Namen für den Markt angeben.")
                db.data["stores"].append(store)
                db.save()
                return None
            store = db.find("stores", item_id)
            if not store:
                raise ApiError(404, "Markt nicht gefunden")
            if method == "PUT":
                store_fields(body, store)
                db.save()
                return None
            if method == "DELETE":
                db.data["stores"].remove(store)
                db.data["offers"] = [o for o in db.data["offers"] if o["store_id"] != item_id]
                db.save()
                return None

    if res == "offers":
        if method == "POST" and not item_id:
            return add_offer(body)
        with db.lock:
            offer = db.find("offers", item_id)
            if not offer:
                raise ApiError(404, "Link nicht gefunden")
        if method == "POST" and action == "refresh":
            refresh_offer(item_id)
            with db.lock:
                db.save()
            return None
        with db.lock:
            if method == "PUT":
                before = best_offer_id(offer["product_id"])
                if "unit_price" in body:
                    offer["unit_price"] = num(body["unit_price"])
                    offer["manual_price"] = body.get("unit_price") not in (None, "")
                if "shipping" in body:
                    offer["shipping"] = num(body["shipping"])
                    offer["manual_shipping"] = body.get("shipping") not in (None, "")
                if "url" in body:
                    offer["url"] = body["url"].strip()
                product = db.find("products", offer["product_id"])
                if product:
                    check_product_alerts(product, before)
                db.save()
                return None
            if method == "DELETE":
                db.data["offers"].remove(offer)
                pid = offer["product_id"]
                if not any(o["product_id"] == pid for o in db.data["offers"]):
                    db.data["products"] = [p for p in db.data["products"] if p["id"] != pid]
                db.save()
                return None

    if res == "products":
        if method == "POST" and action == "compare":
            return compare_product(item_id)
        with db.lock:
            product = db.find("products", item_id)
            if not product:
                raise ApiError(404, "Produkt nicht gefunden")
            if method == "PUT":
                before = best_offer_id(item_id)
                if "name" in body and body["name"].strip():
                    product["name"] = body["name"].strip()
                if "quantity" in body:
                    product["quantity"] = max(1, int(num(body["quantity"], allow_none=False)))
                if "target_price" in body:
                    product["target_price"] = num(body["target_price"])
                    product["target_notified"] = False
                if "image" in body:
                    product["image"] = (body["image"] or "").strip() or None
                if "gtin" in body:
                    product["gtin"] = re.sub(r"\D", "", body["gtin"] or "") or None
                check_product_alerts(product, before)
                db.save()
                return None
            if method == "DELETE":
                db.data["products"].remove(product)
                db.data["offers"] = [o for o in db.data["offers"] if o["product_id"] != item_id]
                db.save()
                return None

    if method == "POST" and res == "check-all":
        threading.Thread(target=check_all, daemon=True).start()
        return {"started": True}

    if method == "POST" and res == "notifications" and item_id == "read":
        with db.lock:
            for n in db.data["notifications"]:
                n["read"] = True
            db.save()
        return None

    if method == "DELETE" and res == "notifications":
        with db.lock:
            db.data["notifications"] = []
            db.save()
        return None

    raise ApiError(404, "Unbekannte Anfrage")


def add_offer(body):
    """Legt einen Link in einem Markt an – mit neuem oder bestehendem Produkt."""
    url = (body.get("url") or "").strip()
    if not re.match(r"^https?://", url, re.I):
        raise ValueError("Bitte einen vollständigen Link mit http:// oder https:// angeben.")
    with db.lock:
        store = db.find("stores", body.get("store_id"))
        if not store:
            raise ValueError("Bitte einen Markt auswählen.")
        product = db.find("products", body.get("product_id")) if body.get("product_id") else None
        if not product:
            name = (body.get("name") or "").strip()
            if not name:
                raise ValueError("Bitte einen Produktnamen angeben.")
            product = {
                "id": new_id(), "name": name,
                "quantity": max(1, int(num(body.get("quantity") or 1, allow_none=False))),
                "image": (body.get("image") or "").strip() or None,
                "gtin": re.sub(r"\D", "", body.get("gtin") or "") or None,
                "target_price": num(body.get("target_price")),
                "created": now_iso(),
            }
            db.data["products"].append(product)
        else:
            if body.get("quantity") not in (None, ""):
                product["quantity"] = max(1, int(num(body["quantity"], allow_none=False)))
            if not product.get("image") and body.get("image"):
                product["image"] = body["image"].strip()
            if not product.get("gtin") and body.get("gtin"):
                product["gtin"] = re.sub(r"\D", "", body["gtin"]) or None
        before = best_offer_id(product["id"])
        price = num(body.get("unit_price"))
        shipping = num(body.get("shipping"))
        offer = {
            "id": new_id(), "store_id": store["id"], "product_id": product["id"], "url": url,
            "unit_price": price, "shipping": shipping,
            "manual_price": bool(body.get("manual_price")),
            "manual_shipping": bool(body.get("manual_shipping")),
            "availability": body.get("availability"),
            "history": [{"date": now_iso(), "price": price}] if price is not None else [],
            "last_checked": now_iso() if price is not None else None,
            "error": None, "created": now_iso(),
        }
        db.data["offers"].append(offer)
        check_product_alerts(product, before)
        db.save()
    return None


def main():
    global db
    db = Store(DATA_FILE)
    db.save()
    threading.Thread(target=background_checker, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}"
    print(f"Baumarkt-Preisvergleich läuft auf {url}  (Beenden mit Strg+C)")
    if "--kein-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")


if __name__ == "__main__":
    main()
