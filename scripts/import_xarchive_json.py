#!/usr/bin/env python3
"""
Import bookmarks from an xarchive (sytelus/xarchive) Chrome-extension export
into the X-Bookmark-Memory repo.

xarchive export layout:
    { "export_metadata": {...}, "folders": [...],
      "bookmarks": [ { "tweet_id", "full_text", "created_at",
                       "author": {"screen_name","name"}, "metrics": {"likes","retweets"},
                       "entities": {"urls": [{"expanded_url"}], "hashtags": [...]},
                       ... }, ... ] }

Usage:
    python3 import_xarchive_json.py /path/to/xarchive_*_combined.json [--repo ~/workspace/x-bookmarks]

What it does:
  1. Loads the xarchive JSON
  2. Converts each bookmark to the site's record format
  3. Categorizes using config/categories.yaml keyword rules (first match wins)
  4. Writes data/bookmarks.json (dedupe by tweet_id)
  5. Mirrors to docs/data/bookmarks.json  (Pages only serves /docs/)
  6. Regenerates bookmarks.md
  7. Updates data/watermark.txt
Does NOT commit/push — the caller reviews then pushes.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.home() / "workspace" / "x-bookmarks"


def load_categories(repo: Path) -> list[dict]:
    """Minimal YAML parse for the simple categories.yaml structure."""
    cats = []
    current = None
    for line in (repo / "config" / "categories.yaml").read_text().splitlines():
        s = line.strip()
        if s.startswith("- name:"):
            name = s.split(":", 1)[1].strip().strip('"').strip("'")
            current = {"name": name, "keywords": []}
            cats.append(current)
        elif s.startswith("keywords:") and current is not None:
            inner = s.split("[", 1)[1].rsplit("]", 1)[0]
            current["keywords"] = [k.strip().strip('"').strip("'").lower()
                                   for k in inner.split(",") if k.strip()]
    return cats


def categorize(text: str, hashtags: list[str], cats: list[dict]) -> str:
    hay = (text + " " + " ".join(hashtags)).lower()
    for c in cats:
        if any(kw in hay for kw in c["keywords"]):
            return c["name"]
    return "Uncategorized"


def convert(bm: dict, cats: list[dict], synced_at: str) -> dict:
    tid = str(bm.get("tweet_id", ""))
    author = bm.get("author") or {}
    handle = author.get("screen_name") or ""
    metrics = bm.get("metrics") or {}
    entities = bm.get("entities") or {}
    urls = [u.get("expanded_url") for u in (entities.get("urls") or [])
            if u.get("expanded_url")]
    hashtags = entities.get("hashtags") or []
    text = bm.get("full_text") or ""
    return {
        "tweet_id": tid,
        "url": f"https://x.com/{handle}/status/{tid}" if handle else f"https://x.com/i/status/{tid}",
        "text": text,
        "author_name": author.get("name") or "",
        "author_handle": handle,
        "tweet_created_at": bm.get("created_at") or "",
        "likes": metrics.get("likes"),
        "reposts": metrics.get("retweets"),
        "expanded_urls": urls,
        "hashtags": hashtags,
        "category": categorize(text, hashtags, cats),
        "hidden": False,
        "synced_at": synced_at,
    }


def main() -> None:
    src = Path(sys.argv[1])
    repo = REPO
    cats = load_categories(repo)

    payload = json.loads(src.read_text(encoding="utf-8"))
    meta = payload.get("export_metadata") or {}
    stats = (meta.get("stats") or {})
    synced_at = meta.get("exported_at") or datetime.now(timezone.utc).isoformat()

    records = [convert(b, cats, synced_at) for b in payload.get("bookmarks", [])
               if b.get("tweet_id")]

    # Dedupe by tweet_id, keep first
    seen, unique = set(), []
    for r in records:
        if r["tweet_id"] not in seen:
            seen.add(r["tweet_id"])
            unique.append(r)

    # Preserve manual edits from the previous import: re-imports must not
    # wipe categories Rajeev re-tagged on the site or items he hid.
    data_path = repo / "data" / "bookmarks.json"
    if data_path.exists():
        try:
            old = {d.get("tweet_id"): d for d in json.loads(data_path.read_text(encoding="utf-8"))}
        except (json.JSONDecodeError, OSError):
            old = {}
        for r in unique:
            prev = old.get(r["tweet_id"])
            if prev:
                if prev.get("category"):
                    r["category"] = prev["category"]
                if prev.get("hidden"):
                    r["hidden"] = True

    data_path.write_text(json.dumps(unique, ensure_ascii=False, indent=1), encoding="utf-8")

    # Mirror for GitHub Pages (only /docs/ is served)
    mirror = repo / "docs" / "data" / "bookmarks.json"
    mirror.write_text(json.dumps(unique, ensure_ascii=False, indent=1), encoding="utf-8")

    # Regenerate bookmarks.md grouped by category
    by_cat: dict[str, list[dict]] = {}
    for r in unique:
        by_cat.setdefault(r["category"], []).append(r)
    lines = [f"# X Bookmarks — {len(unique)} saved", "",
             f"Exported from X on {synced_at[:10]} via xarchive.", ""]
    for cat in sorted(by_cat):
        items = by_cat[cat]
        lines.append(f"## {cat} ({len(items)})")
        lines.append("")
        for r in items[:200]:
            snippet = r["text"].replace("\n", " ")
            snippet = snippet[:140] + ("…" if len(snippet) > 140 else "")
            lines.append(f"- [{snippet}]({r['url']}) — @{r['author_handle']}")
        if len(items) > 200:
            lines.append(f"- …and {len(items) - 200} more on the site")
        lines.append("")
    (repo / "bookmarks.md").write_text("\n".join(lines), encoding="utf-8")

    (repo / "data" / "watermark.txt").write_text(
        f"{synced_at} | xarchive export | {len(unique)} bookmarks "
        f"({stats.get('available_bookmarks', '?')} available, "
        f"{stats.get('unavailable_bookmarks', '?')} unavailable)\n",
        encoding="utf-8")

    from collections import Counter
    dist = Counter(r["category"] for r in unique)
    print(f"Imported {len(unique)} bookmarks")
    print("Category distribution:")
    for cat, n in dist.most_common():
        print(f"  {cat}: {n}")
    print(f"Collection completeness per export: {meta.get('collection', {})}")


if __name__ == "__main__":
    main()
