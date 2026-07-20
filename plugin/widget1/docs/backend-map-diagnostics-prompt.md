# Backend Prompt: Confirm `show_stats`/`show_labels`/`show_legend` Actually Suppress All Map Annotations

## Problem

Exported PDF advisory briefs (Page 1's executive map, Page 4's four-vessel-per-day comparison panels) embed map images from the operational-map endpoint. In at least one reviewed PDF, those embedded images still showed:

- Tiny place labels
- A scale bar and north arrow
- A top-left diagnostic text strip reading something like "Warning… Caution… Wind max…"

These become illegible at the reduced size they're placed at in the PDF, and on Page 4 specifically, the frontend draws its own status banner in the same top region of the panel — so if the source image also carries its own annotations there, the two visually collide.

## What the frontend already sends

Every map-image request from the PDF exporter already asks for these to be off:

```http
GET /niue/suitability/operational-map/{vessel}/{time_index}?width=900&height=650&dpi=150&show_labels=false&show_legend=false&show_class_boundaries=true&show_stats=false&view_radius_km=45&dissolve_classes=true
```

(`show_stats: false` is hardcoded into every request from this endpoint — the frontend has no code path that ever sends `show_stats=true`.)

## What we need confirmed

1. Does `show_stats=false` suppress **all** diagnostic/stat annotations drawn onto the image — including the top-left text block (hazard summary, wind max, etc.), not just a subset?
2. Do `show_labels=false` and `show_legend=false` suppress place-name labels, the scale bar, and the north arrow specifically, or do those come from a separate code path not gated by either flag?
3. Is there a deployed version where these params were added but not yet wired to every annotation layer — i.e., could an older deployment still be drawing some of these unconditionally regardless of the query string?

## How to verify on your end

Render the exact request above (or the equivalent for `/niue/suitability/operational-map/small_craft/0`) and visually confirm the output PNG has **no** text, scale bar, north arrow, or diagnostic strip anywhere in the frame — just the classified polygons. If anything still renders, it's either gated on a flag this list doesn't cover yet, or it's unconditional and needs a new flag (or needs folding into one of the existing three).

## Not backend work

Two related things from the same review were frontend-only and are already fixed on our side, mentioned here only so they're not duplicated:

- The A3 poster's map request was rendering at ~132 PPI at final print size (too low for a print artifact) — bumped to ~300 PPI, no backend change needed.
- The frontend's client-side screenshot fallback (used only when this endpoint is unreachable) had a dead exclusion filter checking for a Leaflet class name on a MapLibre-based map — fixed to actually exclude the zoom/compass controls from that fallback capture.
