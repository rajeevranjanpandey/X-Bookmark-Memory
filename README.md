# X-Bookmark-Memory

Your X bookmarks, automatically archived and organized. Every bookmark you save
on X lands here once a day — categorized, searchable, and browsable as a
website.

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

A scheduled job runs daily:

1. Pulls new bookmarks from the X API
2. Extracts title, link, description, author, date
3. Categorizes each (keyword rules → LLM fallback)
4. Commits to this repo — the website updates automatically

Details: [`DESIGN.md`](DESIGN.md).

## Replicate it

1. X API Basic tier or higher (bookmarks endpoint isn't on Free)
2. Fork this repo, add your X credentials to your scheduler's secret store
3. Point the daily job at your account — see `DESIGN.md` §11

## Categories

Defined in [`config/categories.yaml`](config/categories.yaml). Edit the file
and re-run the renderer to re-slice the whole archive.
