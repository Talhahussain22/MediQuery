"""
Scrape Pakistani medicine data from dawaai.pk (product pages allowed by robots.txt)
and write a CSV with the same columns the MediQuery backend expects.

Usage:
    py scrape_dawaai.py            # scrape (resumable) then build CSV
    py scrape_dawaai.py --csv-only # rebuild CSV from already-scraped data
    py scrape_dawaai.py --limit 50 # quick test run
"""
import argparse
import csv
import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests
from bs4 import BeautifulSoup

HERE = Path(__file__).parent
RAW = HERE / "dawaai_raw.jsonl"
FAILED = HERE / "dawaai_failed.txt"
OUT_CSV = HERE.parent / "Pakistan_medicines_dataset.csv"
SITEMAPS = [
    "https://dawaai.pk/sitemap.xml",
    "https://dawaai.pk/sitemap_second.xml",
    "https://dawaai.pk/sitemap_new.xml",
]
HEADERS = {"User-Agent": "Mozilla/5.0 (MediQuery student project scraper)"}
WORKERS = 3
DELAY = 0.7  # seconds between requests per worker

COLUMNS = [
    "id", "name", "price", "Is_discontinued", "manufacturer_name", "type",
    "pack_size_label", "short_composition1", "short_composition2",
    "substitute0", "substitute1", "substitute2", "substitute3", "substitute4",
    "Consolidated_Side_Effects", "use0", "use1", "use2", "use3", "use4",
    "Chemical Class", "Habit Forming", "Therapeutic Class", "Action Class",
    "Prescription Required", "url",
]

lock = threading.Lock()


def get_medicine_urls():
    urls = set()
    for sm in SITEMAPS:
        xml = requests.get(sm, headers=HEADERS, timeout=60).text
        for loc in re.findall(r"<loc>([^<]+)</loc>", xml):
            loc = loc.strip()
            if "/medicine/" not in loc:
                continue
            # fix malformed entries like ".../panadol-2-24326.htmlpanadol-2-24326.html"
            m = re.match(r"(https://dawaai\.pk/medicine/.*?\.html)", loc)
            if m:
                urls.add(m.group(1))
    return sorted(urls)


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


NA = {"not available", "n/a", "na", "-"}


def as_list(v):
    if not v or (isinstance(v, str) and v.strip().lower() in NA):
        return []
    if isinstance(v, str):
        return [x.strip() for x in v.split(",") if x.strip()]
    return [clean(str(x)) for x in v if x and clean(str(x)).lower() not in NA]


def section_items(soup, heading):
    """Collect li/p text after an <h2> with exact heading text, up to the next <h2>."""
    for h2 in soup.find_all("h2"):
        if clean(h2.get_text()).lower() != heading.lower():
            continue
        items = []
        for sib in h2.find_all_next():
            if sib.name == "h2":
                break
            if sib.name in ("li", "p"):
                t = clean(sib.get_text())
                if t and "lorem ipsum" not in t.lower() and t not in items:
                    items.append(t)
        if items:
            return items
    return []


def parse(url, html):
    soup = BeautifulSoup(html, "html.parser")

    details = {}
    m = re.search(r"details_data\s*=\s*(\{.*?\});", html)
    if m:
        try:
            details = json.loads(m.group(1))
        except json.JSONDecodeError:
            pass

    product, drug = {}, {}
    for s in soup.find_all("script", type="application/ld+json"):
        try:
            d = json.loads(s.string or "")
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(d, dict):
            if d.get("@type") == "Product":
                product = d
            elif d.get("@type") == "Drug":
                drug = d

    if not details and not product:
        return None

    title = clean(soup.title.get_text()) if soup.title else ""
    title = re.split(r"\s*(?:—|&mdash;)\s*Dawaai|:\s*View Uses|\s*\|\s*Dawaai", title)[0].strip()
    h1 = soup.find("h1")
    h1 = clean(h1.get_text()) if h1 else ""

    generics = as_list(details.get("Generic Name"))
    if not generics and drug.get("nonProprietaryName"):
        generics = [g.strip() for g in drug["nonProprietaryName"].split(",")]

    primary_uses = section_items(soup, "Primary Uses")
    uses = []
    for u in as_list(details.get("Type of Disease")) + primary_uses:
        if u and u not in uses:
            uses.append(u)

    name = title or details.get("Item Name") or product.get("name", "")
    similar = []
    for s in as_list(details.get("Similar Products")):
        short = (details.get("Item Name") or product.get("name", "")).lower()
        if s and s.lower() not in (name.lower(), short) and s not in similar:
            similar.append(s)

    return {
        "url": url,
        "product_id": details.get("Product ID") or product.get("productID"),
        "name": name,
        "short_name": details.get("Item Name") or product.get("name", ""),
        "h1": h1,
        "price": details.get("Item Cost") or (product.get("offers") or {}).get("price"),
        "manufacturer": details.get("Item Brand") or (product.get("brand") or {}).get("name"),
        "dosage_form": drug.get("dosageForm", ""),
        "generics": generics,
        "category": "" if str(details.get("Item Category", "")).lower() in NA else details.get("Item Category", ""),
        "uses": uses,
        "similar": similar,
        "side_effects": section_items(soup, "Side Effects"),
        "prescription": details.get("Prescription Required", ""),
        "stock": details.get("Stock Status", ""),
    }


def fetch(session, url):
    for attempt in range(3):
        try:
            r = session.get(url, headers=HEADERS, timeout=30)
            if r.status_code == 200:
                return r.text
            if r.status_code in (404, 410):
                return None
        except requests.RequestException:
            pass
        time.sleep(3 * (attempt + 1))
    return None


def worker(url):
    session = requests.Session()
    html = fetch(session, url)
    time.sleep(DELAY)
    try:
        rec = parse(url, html) if html else None
    except Exception as e:
        print(f"parse error {url}: {e}", flush=True)
        rec = None
    with lock:
        if rec:
            with RAW.open("a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        else:
            with FAILED.open("a", encoding="utf-8") as f:
                f.write(url + "\n")
    return rec is not None


def scrape(limit=None):
    done = set()
    for p in (RAW, FAILED):
        if p.exists():
            for line in p.read_text(encoding="utf-8").splitlines():
                done.add(json.loads(line)["url"] if p == RAW else line.strip())

    urls = [u for u in get_medicine_urls() if u not in done]
    if limit:
        urls = urls[:limit]
    print(f"{len(done)} already done, {len(urls)} to scrape", flush=True)

    ok = 0
    with ThreadPoolExecutor(WORKERS) as ex:
        futures = [ex.submit(worker, u) for u in urls]
        for i, fut in enumerate(as_completed(futures), 1):
            ok += fut.result()
            if i % 200 == 0 or i == len(urls):
                print(f"{i}/{len(urls)} processed, {ok} parsed", flush=True)


def pack_size(h1, short_name, dosage_form):
    # h1 looks like "Panadol Extra  tablet 10x10's" -> "tablet 10x10's"
    rest = clean(h1)
    if short_name and rest.lower().startswith(short_name.lower()):
        rest = rest[len(short_name):].strip()
    return rest or dosage_form


def build_csv():
    recs = {}
    for line in RAW.read_text(encoding="utf-8").splitlines():
        r = json.loads(line)
        recs[r["url"]] = r  # dedupe by url

    rows, seen_names = [], set()
    for r in recs.values():
        name = r["name"]
        if not name or name.lower() in seen_names:
            continue
        seen_names.add(name.lower())
        g = r["generics"]
        sub = (r["similar"] + [""] * 5)[:5]
        use = (r["uses"] + [""] * 5)[:5]
        side = ", ".join(r["side_effects"])
        rows.append({
            "id": len(rows) + 1,
            "name": name,
            "price": r["price"] or "",
            "Is_discontinued": "FALSE" if r["stock"] != "Discontinued" else "TRUE",
            "manufacturer_name": r["manufacturer"] or "",
            "type": "allopathy",
            "pack_size_label": pack_size(r["h1"], r["short_name"], r["dosage_form"]),
            "short_composition1": g[0] if g else "",
            "short_composition2": " + ".join(g[1:]) if len(g) > 1 else "",
            **{f"substitute{i}": sub[i] for i in range(5)},
            "Consolidated_Side_Effects": side,
            **{f"use{i}": use[i] for i in range(5)},
            "Chemical Class": "",
            "Habit Forming": "",
            "Therapeutic Class": r["category"] or "",
            "Action Class": "",
            "Prescription Required": r["prescription"] or "",
            "url": r["url"],
        })

    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {len(rows)} medicines to {OUT_CSV}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--csv-only", action="store_true")
    args = ap.parse_args()
    if not args.csv_only:
        scrape(args.limit)
    build_csv()
