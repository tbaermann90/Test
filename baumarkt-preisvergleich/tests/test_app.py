import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app  # noqa: E402
import pricing  # noqa: E402
import scraper  # noqa: E402

PRODUCT_PAGE = """<html><head><title>Akkuschrauber X</title>
<meta property="og:image" content="/img/x.jpg">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"BreadcrumbList"},
 {"@type":"Product","name":"Akkuschrauber X 18V","gtin13":"4006825123456",
  "image":["https://cdn.example/x.jpg"],
  "offers":{"@type":"Offer","price":"%s","priceCurrency":"EUR",
    "availability":"https://schema.org/InStock",
    "shippingDetails":{"shippingRate":{"value":"5.95","currency":"EUR"}}}}]}
</script></head><body></body></html>"""

OG_PAGE = """<html><head>
<meta property="og:title" content="Spax 4x40 &amp; mehr">
<meta property="og:image" content="/bilder/spax.png">
<meta property="product:price:amount" content="12,49">
</head></html>"""


class ScraperTest(unittest.TestCase):
    def test_json_ld(self):
        d = scraper.extract(PRODUCT_PAGE % "89.90", "https://shop.example/p/1")
        self.assertEqual(d["name"], "Akkuschrauber X 18V")
        self.assertEqual(d["price"], 89.90)
        self.assertEqual(d["shipping"], 5.95)
        self.assertEqual(d["gtin"], "4006825123456")
        self.assertEqual(d["image"], "https://cdn.example/x.jpg")
        self.assertEqual(d["availability"], "InStock")

    def test_open_graph_fallback(self):
        d = scraper.extract(OG_PAGE, "https://shop.example/a/b")
        self.assertEqual(d["name"], "Spax 4x40 & mehr")
        self.assertEqual(d["price"], 12.49)
        self.assertEqual(d["image"], "https://shop.example/bilder/spax.png")

    def test_parse_price(self):
        self.assertEqual(scraper.parse_price("1.299,00 €"), 1299.0)
        self.assertEqual(scraper.parse_price("1,299.00"), 1299.0)
        self.assertEqual(scraper.parse_price("12.99"), 12.99)
        self.assertEqual(scraper.parse_price("4,95"), 4.95)
        self.assertIsNone(scraper.parse_price("ab"))


class PricingTest(unittest.TestCase):
    settings = {"home": {"lat": 48.137, "lon": 11.575}, "radius_km": 10}
    stores = {
        "near": {"id": "near", "kind": "markt", "lat": 48.15, "lon": 11.58},
        "far": {"id": "far", "kind": "markt", "lat": 48.40, "lon": 11.75},
        "web": {"id": "web", "kind": "online", "shipping_cost": 5.0, "free_shipping_from": 100},
    }

    def evaluate(self, offers, qty=1):
        return pricing.evaluate_product({"quantity": qty}, offers, self.stores, self.settings)

    def test_pickup_cheaper_than_delivery_with_shipping(self):
        ev = self.evaluate([
            {"id": "a", "store_id": "near", "unit_price": 10.0},
            {"id": "b", "store_id": "web", "unit_price": 8.0, "shipping": None},
        ])
        self.assertEqual(ev["best"]["offer_id"], "a")
        self.assertEqual(ev["best"]["total"], 10.0)
        self.assertEqual(ev["best_delivery"]["total"], 13.0)

    def test_delivery_wins_when_cheaper_including_shipping(self):
        ev = self.evaluate([
            {"id": "a", "store_id": "near", "unit_price": 30.0},
            {"id": "b", "store_id": "web", "unit_price": 20.0},
        ], qty=3)
        # Markt: 90 €, Online: 60 € + 5 € Versand = 65 €
        self.assertEqual(ev["best"]["offer_id"], "b")
        self.assertEqual(ev["best"]["total"], 65.0)

    def test_free_shipping_threshold(self):
        ev = self.evaluate([{"id": "b", "store_id": "web", "unit_price": 50.0}], qty=2)
        self.assertEqual(ev["best"]["shipping"], 0.0)
        self.assertEqual(ev["best"]["total"], 100.0)

    def test_store_outside_radius_is_ignored(self):
        ev = self.evaluate([
            {"id": "a", "store_id": "far", "unit_price": 1.0},
            {"id": "b", "store_id": "near", "unit_price": 9.0},
        ])
        self.assertEqual(ev["best"]["offer_id"], "b")


class _Shop(BaseHTTPRequestHandler):
    price = "99.00"

    def log_message(self, *a):
        pass

    def do_GET(self):
        body = (PRODUCT_PAGE % _Shop.price).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        app.db = app.Store(os.path.join(cls.tmp.name, "daten.json"))
        cls.shop = ThreadingHTTPServer(("127.0.0.1", 0), _Shop)
        cls.api = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        for s in (cls.shop, cls.api):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        cls.shop_url = f"http://127.0.0.1:{cls.shop.server_port}/p/1"
        cls.base = f"http://127.0.0.1:{cls.api.server_port}/api/"

    @classmethod
    def tearDownClass(cls):
        cls.shop.shutdown()
        cls.api.shutdown()
        cls.tmp.cleanup()

    def call(self, method, path, body=None):
        req = urllib.request.Request(
            self.base + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Content-Type": "application/json", "X-Baumarkt": "1"})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def test_full_flow(self):
        st = self.call("POST", "stores", {"name": "Online-Baumarkt", "kind": "online",
                                          "shipping_cost": "4,95"})
        store = st["stores"][0]
        prev = self.call("POST", "preview", {"url": self.shop_url})
        self.assertEqual(prev["price"], 99.0)
        st = self.call("POST", "offers", {
            "store_id": store["id"], "url": self.shop_url, "name": prev["name"],
            "quantity": 2, "unit_price": prev["price"], "shipping": prev["shipping"],
            "gtin": prev["gtin"], "image": prev["image"]})
        p = st["products"][0]
        self.assertEqual(p["evaluation"]["best"]["total"], 2 * 99 + 5.95)
        self.assertEqual(st["grand_total"], 203.95)

        # Preissenkung beim Shop -> Benachrichtigung
        _Shop.price = "79.00"
        st = self.call("POST", f"offers/{p['offers'][0]['id']}/refresh")
        self.assertEqual(st["products"][0]["offers"][0]["unit_price"], 79.0)
        self.assertEqual(st["unread"], 1)
        self.assertIn("Angebot", st["notifications"][0]["text"])

    def test_write_requires_header(self):
        req = urllib.request.Request(self.base + "stores", method="POST", data=b"{}")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req)
        self.assertEqual(cm.exception.code, 403)


if __name__ == "__main__":
    unittest.main()
