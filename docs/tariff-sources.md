# Chapter 99 additional duties: research and sign-off

`data/additional-duties.json` has one entry per (origin, HTS) pair in our data. **The engine applies an
entry only when `verified: true`.** Until then, landed cost flags the line `unverifiedAdditionalDuty`,
and any duty gap on the broker's customs entry becomes a `source_disagreement` that goes to the controller.

## Pairs to research (sim window 2026-03-01 .. 2026-09-30)

| Origin | HTS | Part | Status |
|---|---|---|---|
| MX | 8501.31.40 | P07 motor (Atlas) | unresearched |
| MX | 7318.15.60 | P14 M3 screws (Atlas) | unresearched |
| TW | 8537.10.91 | P04 flight controller (Vireo) | unresearched |
| TW | 8504.40.40 | P05 ESC (Vireo) | unresearched |
| JP | 8525.89.50 | P10 camera (Hoshi) | unresearched |
| JP | 8807.30.00 | P11 gimbal (Hoshi) | unresearched |
| CN | 8537.10.91 | P04 substitute (planted) | unresearched |

## What a verified entry needs
For each heading that applies: the heading number, the rate, `effectiveFrom`/`effectiveTo`, the U.S. Note
that puts this HTS code and origin under the heading, the **HTS revision** the text comes from, and its
source URL. If no Chapter 99 duty applies, set `none: true` with the same sourcing. Then set
`verified: true` and `verifiedBy`.

## Sources found so far (2026-10-23)
- Heading text, current revision: `https://hts.usitc.gov/reststop/search?keyword=<heading>` (cached by
  `npm run fetch:hts` in `data/cache/hts/chapter99.json`). This is **today's** text only.
- Revision history: `https://hts.usitc.gov/reststop/releaseList`. Revisions during the sim window:
  2026 Rev 4 (published 02/23) through Rev 20 (09/23); current is Rev 21 (10/07). The `search` endpoint
  appears to ignore a release parameter, so archived revisions have to come from the archive downloads.
- Not modeled: MPF and HMF (generated customs entries leave them out; the UI says so).
