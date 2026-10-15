"""Liest Produktdaten (Name, Bild, Preis, Versand, EAN) aus Shop-Seiten.

Die meisten Shops betten strukturierte Daten nach schema.org (JSON-LD) oder
Open-Graph-Meta-Tags ein. Beides wird hier ausgewertet. Es werden nur
Bibliotheken aus der Python-Standardbibliothek benutzt.
"""

import difflib
import gzip
import json
import re
import urllib.parse
import urllib.request
import zlib
from html import unescape
from html.parser import HTMLParser

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0 Safari/537.36"
)
MAX_BYTES = 4 * 1024 * 1024


class ScrapeError(Exception):
    pass


def fetch(url, timeout=20):
    if not re.match(r"^https?://", url or "", re.I):
        raise ScrapeError("Bitte einen vollständigen Link mit http:// oder https:// angeben.")
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        "Accept-Encoding": "gzip, deflate",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read(MAX_BYTES)
            encoding = (resp.headers.get("Content-Encoding") or "").lower()
            charset = resp.headers.get_content_charset() or "utf-8"
            final_url = resp.geturl()
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 429, 503):
            raise ScrapeError(
                f"Der Shop blockiert automatische Abrufe (HTTP {e.code}). "
                "Preis bitte von Hand eintragen.") from e
        raise ScrapeError(f"Seite konnte nicht geladen werden (HTTP {e.code}).") from e
    except Exception as e:  # noqa: BLE001 - Netzwerkfehler aller Art
        raise ScrapeError(f"Seite konnte nicht geladen werden: {e}") from e
    if encoding == "gzip":
        raw = gzip.decompress(raw)
    elif encoding == "deflate":
        raw = zlib.decompress(raw)
    return raw.decode(charset, errors="replace"), final_url


class _Collector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.itemprops = {}
        self.ld_json = []
        self.title = ""
        self._in_ld = False
        self._in_title = False
        self._buf = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and "content" in a:
                self.meta.setdefault(key, a["content"])
            if a.get("itemprop") and "content" in a:
                self.itemprops.setdefault(a["itemprop"].lower(), a["content"])
        elif a.get("itemprop") and "content" in a:
            self.itemprops.setdefault(a["itemprop"].lower(), a["content"])
        if tag == "script" and "ld+json" in a.get("type", "").lower():
            self._in_ld, self._buf = True, []
        elif tag == "title":
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == "script" and self._in_ld:
            self._in_ld = False
            self.ld_json.append("".join(self._buf))
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_ld:
            self._buf.append(data)
        elif self._in_title:
            self.title += data


def parse_price(value):
    """Wandelt '1.299,00 €', '12.99', 12.99 usw. in eine Zahl um."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = re.sub(r"[^\d,.\-]", "", str(value))
    if not s or not re.search(r"\d", s):
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    elif s.count(".") > 1:
        s = s.replace(".", "")
    try:
        return round(float(s), 2)
    except ValueError:
        return None


def _load_json(text):
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Manche Shops liefern Steuerzeichen oder abschließende Kommas.
        cleaned = re.sub(r"[\x00-\x1f]", " ", text)
        cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return None


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _has_type(node, name):
    t = node.get("@type")
    if isinstance(t, list):
        return any(str(x).lower() == name.lower() for x in t)
    return str(t).lower() == name.lower()


def _first_image(img):
    if isinstance(img, list):
        img = img[0] if img else None
    if isinstance(img, dict):
        img = img.get("url") or img.get("contentUrl")
    return img if isinstance(img, str) else None


def _shipping_from_offer(offer):
    details = offer.get("shippingDetails")
    if isinstance(details, list):
        details = details[0] if details else None
    if isinstance(details, dict):
        rate = details.get("shippingRate")
        if isinstance(rate, dict):
            return parse_price(rate.get("value"))
    return None


def _product_from_ld(node):
    offers = node.get("offers")
    if isinstance(offers, list):
        offers = offers[0] if offers else None
    price = shipping = currency = availability = None
    if isinstance(offers, dict):
        price = parse_price(offers.get("price"))
        if price is None:
            price = parse_price(offers.get("lowPrice"))
        if price is None:
            spec = offers.get("priceSpecification")
            if isinstance(spec, list):
                spec = spec[0] if spec else None
            if isinstance(spec, dict):
                price = parse_price(spec.get("price"))
        shipping = _shipping_from_offer(offers)
        currency = offers.get("priceCurrency")
        availability = offers.get("availability")
    gtin = None
    for key in ("gtin13", "gtin", "gtin14", "gtin12", "gtin8", "ean"):
        if node.get(key):
            gtin = re.sub(r"\D", "", str(node[key])) or None
            if gtin:
                break
    brand = node.get("brand")
    if isinstance(brand, dict):
        brand = brand.get("name")
    return {
        "name": unescape(str(node.get("name") or "")).strip() or None,
        "image": _first_image(node.get("image")),
        "price": price,
        "shipping": shipping,
        "currency": currency,
        "availability": str(availability).rsplit("/", 1)[-1] if availability else None,
        "gtin": gtin,
        "sku": str(node.get("sku")) if node.get("sku") else None,
        "brand": brand if isinstance(brand, str) else None,
        "url": node.get("url") if isinstance(node.get("url"), str) else None,
    }


def extract(html, base_url=""):
    """Gibt ein Dict mit den gefundenen Produktdaten zurück."""
    c = _Collector()
    try:
        c.feed(html)
    except Exception:  # noqa: BLE001 - kaputtes HTML soll nicht abstürzen
        pass

    products = []
    for raw in c.ld_json:
        data = _load_json(raw)
        for node in _walk(data):
            if _has_type(node, "Product") or _has_type(node, "ProductGroup"):
                products.append(_product_from_ld(node))
    # Das Produkt mit Preis bevorzugen (manche Seiten listen Zubehör mit).
    products.sort(key=lambda p: (p["price"] is None, p["name"] is None))
    result = products[0] if products else {
        "name": None, "image": None, "price": None, "shipping": None,
        "currency": None, "availability": None, "gtin": None, "sku": None,
        "brand": None, "url": None,
    }

    m, ip = c.meta, c.itemprops
    if not result["name"]:
        result["name"] = (m.get("og:title") or ip.get("name") or c.title.strip() or None)
    if not result["image"]:
        result["image"] = m.get("og:image") or m.get("og:image:url") or ip.get("image")
    if result["price"] is None:
        for key in ("product:price:amount", "og:price:amount", "product:sale_price:amount"):
            if m.get(key):
                result["price"] = parse_price(m[key])
                break
        if result["price"] is None and ip.get("price"):
            result["price"] = parse_price(ip["price"])
    if not result["currency"]:
        result["currency"] = m.get("product:price:currency") or ip.get("pricecurrency")
    if not result["gtin"]:
        for key in ("gtin13", "gtin", "ean"):
            if ip.get(key):
                result["gtin"] = re.sub(r"\D", "", ip[key]) or None
                break

    if result["image"] and base_url:
        result["image"] = urllib.parse.urljoin(base_url, result["image"])
    if result["name"]:
        result["name"] = re.sub(r"\s+", " ", result["name"]).strip()
    return result


def extract_listing(html, base_url=""):
    """Sucht auf einer Suchergebnis-Seite nach Produkten und Produktlinks."""
    c = _Collector()
    try:
        c.feed(html)
    except Exception:  # noqa: BLE001
        pass
    found, links = [], []
    for raw in c.ld_json:
        data = _load_json(raw)
        for node in _walk(data):
            if _has_type(node, "Product"):
                p = _product_from_ld(node)
                if p["url"]:
                    p["url"] = urllib.parse.urljoin(base_url, p["url"])
                found.append(p)
            elif _has_type(node, "ListItem"):
                url = node.get("url")
                if not url and isinstance(node.get("item"), dict):
                    url = node["item"].get("url") or node["item"].get("@id")
                elif not url and isinstance(node.get("item"), str):
                    url = node["item"]
                if isinstance(url, str):
                    links.append(urllib.parse.urljoin(base_url, url))
    return found, links


def scrape(url):
    html, final_url = fetch(url)
    data = extract(html, final_url)
    if not data["name"] and data["price"] is None:
        raise ScrapeError(
            "Auf der Seite wurden keine Produktdaten gefunden. "
            "Name und Preis bitte von Hand eintragen.")
    return data


def similarity(a, b):
    def norm(s):
        return " ".join(sorted(re.findall(r"[a-z0-9äöüß]+", (s or "").lower())))
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()
