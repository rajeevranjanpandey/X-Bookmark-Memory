# X-Bookmark-Memory

Your X bookmarks, archived and organized. Export your bookmarks and they land
here — categorized, searchable, and browsable as a website.

🌐 **Browse it:** https://rajeevranjanpandey.github.io/X-Bookmark-Memory/

## What's inside

| File | Purpose |
|---|---|
| `bookmarks.md` | Human-readable archive, grouped by category |
| `data/bookmarks.json` | Full machine-readable records (source of truth) |
| `data/watermark.txt` | Last synced tweet ID (sync resume point) |
| `config/categories.yaml` | Category names + keyword lists (edit to make it yours) |
| `DESIGN.md` | Full architecture: why, what, and how to replicate |
| `docs/` | The browsable website (GitHub Pages) |

## How it works

1. **Export** — your bookmarks leave X through the free
   [sytelus/xarchive](https://github.com/sytelus/xarchive) Chrome extension
   (steps below). Note: X's own "Download your data" archive does **not**
   include bookmarks — verified October 2026.
2. **Import** — `scripts/import_xarchive_json.py` converts the extension's
   combined JSON into the site format and auto-tags every bookmark using the
   keyword rules in `config/categories.yaml`.
3. **Render & publish** — the site in `docs/` and `bookmarks.md` are rebuilt
   from `data/bookmarks.json`; pushing to GitHub updates the live site.

## Export your X bookmarks — free, no paid API needed

Bookmarks are pulled with your own X login through the
**[sytelus/xarchive](https://github.com/sytelus/xarchive)** Chrome extension —
free, open source, and privacy-first (it reads X with your own login; no paid
X API tier required). Credit and thanks to
[@sytelus](https://github.com/sytelus) for building it.

Steps (about 10 minutes the first time):

1. Clone the extension:

   ```bash
   git clone https://github.com/sytelus/xarchive.git
   ```

   ![Cloning the xarchive extension](https://files.catbox.moe/xdsbdt.jpg)

2. In Chrome, open `chrome://extensions/`, turn on **Developer mode**
   (top right), click **Load unpacked**, and select the `xarchive` folder.
   (On macOS the clone lands in your home folder, e.g.
   `/Users/<you>/xarchive` — in the file picker press `Cmd + Shift + G`,
   paste the path, and hit Enter.)

3. Go to [x.com](https://x.com) in Chrome so the extension picks up your login.

4. Click the xarchive toolbar icon → choose **Full refresh — all bookmarks
   and folders** → let it run through your bookmarks. A few thousand
   bookmarks take a few minutes.

   ![xarchive running a full refresh of bookmarks](https://files.catbox.moe/z5t2xk.jpg)

5. When it finishes, click **Download combined archive** — you get one JSON
   file holding all your bookmarks.

6. Convert it into the site's format:

   ```bash
   python3 scripts/import_xarchive_json.py /path/to/xarchive_*_combined.json
   ```

   Then commit and push — the site updates automatically.

## Free vs paid bookmark export

| Route | Cost | How it works | Result |
|---|---|---|---|
| **X's own "Download your data" archive** | Free | X settings → "Download an archive of your data" | ❌ Bookmarks are **not** included — verified Oct 2026: a 316 MB archive contained no bookmarks file anywhere in it |
| **xarchive Chrome extension** ([sytelus/xarchive](https://github.com/sytelus/xarchive)) | Free | Extension reads X with your login; you export and import manually | ✅ Full bookmark text, author, date, and media — the route this repo uses |
| **X API (Basic tier and up)** | Paid monthly | Bookmarks endpoint with the `bookmark.read` scope | ✅ Fully automatic — but the X Free tier cannot fetch bookmarks at all |

## Categories

Defined in [`config/categories.yaml`](config/categories.yaml). Edit the file
and re-run the importer to re-slice the whole archive. Current set: Image
Generation, Video & Animation, Learning, LLM, AI, Paper Writing, Data,
Career, Startups, Finance, Tech, Productivity, Design, Fun — plus
Uncategorized for anything unmatched. LLM and AI are pinned first on the
site's category chips.

## Replicate it

1. Export your bookmarks with the free xarchive extension (steps above) —
   or use the X API Basic tier or higher if you'd rather have it fully
   automatic (the bookmarks endpoint isn't available on the X Free tier).
2. Fork this repo and run `scripts/import_xarchive_json.py` on your export.
3. Enable GitHub Pages on the `docs/` folder — the site goes live.

Details: [`DESIGN.md`](DESIGN.md).
