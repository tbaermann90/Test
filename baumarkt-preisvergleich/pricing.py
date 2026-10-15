"""Berechnet für jedes Produkt die günstigste Einkaufsmöglichkeit.

Jedes Angebot kann auf zwei Wegen gekauft werden:
  * Abholung im Markt  – nur wenn der Markt einen Standort hat und im
                         eingestellten Umkreis liegt. Kein Versand.
  * Lieferung          – nur wenn der Shop liefert. Preis + Versand
                         (entfällt ab dem Mindestbestellwert für Gratisversand).
Die günstigste aller Möglichkeiten wird als Bestpreis markiert.
"""

import math

PICKUP = "abholung"
DELIVERY = "lieferung"


def distance_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def store_distance(store, settings):
    home = settings.get("home") or {}
    if None in (store.get("lat"), store.get("lon"), home.get("lat"), home.get("lon")):
        return None
    return round(distance_km(home["lat"], home["lon"], store["lat"], store["lon"]), 1)


def offer_options(offer, store, quantity, settings):
    """Alle Kaufmöglichkeiten für ein Angebot inklusive Gesamtpreis."""
    price = offer.get("unit_price")
    if price is None or store is None:
        return []
    subtotal = round(price * quantity, 2)
    options = []
    kind = store.get("kind", "markt")
    radius = settings.get("radius_km") or 0

    if kind in ("markt", "beides"):
        dist = store_distance(store, settings)
        in_radius = dist is None or dist <= radius
        options.append({
            "type": PICKUP,
            "subtotal": subtotal,
            "shipping": 0.0,
            "total": subtotal,
            "distance_km": dist,
            "available": in_radius,
            "note": ("Entfernung unbekannt" if dist is None
                     else f"{dist:.1f} km" + ("" if in_radius else " – außerhalb Umkreis")),
        })

    if kind in ("online", "beides"):
        shipping = offer.get("shipping")
        if shipping is None:
            shipping = store.get("shipping_cost")
        free_from = store.get("free_shipping_from")
        shipping_unknown = shipping is None
        shipping = shipping or 0.0
        if free_from is not None and subtotal >= free_from:
            shipping = 0.0
            shipping_unknown = False
        options.append({
            "type": DELIVERY,
            "subtotal": subtotal,
            "shipping": round(shipping, 2),
            "total": round(subtotal + shipping, 2),
            "distance_km": None,
            "available": True,
            "note": ("Versandkosten unbekannt" if shipping_unknown
                     else "versandkostenfrei" if shipping == 0 else "inkl. Versand"),
        })
    return options


def evaluate_product(product, offers, stores_by_id, settings):
    qty = max(1, int(product.get("quantity") or 1))
    rows, candidates = [], []
    for offer in offers:
        store = stores_by_id.get(offer["store_id"])
        options = offer_options(offer, store, qty, settings)
        rows.append({"offer_id": offer["id"], "options": options})
        for opt in options:
            if opt["available"]:
                candidates.append((opt["total"], offer["id"], opt))

    best = best_pickup = best_delivery = None
    if candidates:
        candidates.sort(key=lambda c: (c[0], c[2]["type"] != PICKUP))
        best = {"offer_id": candidates[0][1], **candidates[0][2]}
        for total, oid, opt in candidates:
            if opt["type"] == PICKUP and best_pickup is None:
                best_pickup = {"offer_id": oid, **opt}
            if opt["type"] == DELIVERY and best_delivery is None:
                best_delivery = {"offer_id": oid, **opt}

    totals = [c[0] for c in candidates]
    return {
        "quantity": qty,
        "rows": rows,
        "best": best,
        "best_pickup": best_pickup,
        "best_delivery": best_delivery,
        "savings": round(max(totals) - min(totals), 2) if len(totals) > 1 else 0.0,
    }
