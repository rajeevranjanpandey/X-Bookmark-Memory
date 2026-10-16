# X-Bookmark-Memory

An automated archive of your X (Twitter) bookmarks — synced on a schedule into a
searchable, categorized Git repository. Bookmarks rot; this makes them last.

**How it works:** a scheduled worker polls your X bookmarks (official API, Basic
tier), captures each one as a structured JSON record, categorizes it (keyword
rules first, LLM fallback), renders human-readable Markdown, and commits it all
here. A watermark advances only after each successful push, so no bookmark is
ever silently lost.

📖 **Full spec: [DESIGN.md](DESIGN.md)** — problem & non-goals, constraints,
architecture, data schema, the 9-step sync flow, categorization, dedupe,
failure modes, security, repo layout, a 6-step replication guide, and the
decision log.

## Status

Design complete. Implementation follows `DESIGN.md`.
