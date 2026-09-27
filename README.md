# @absolutejs/audience-audiense

Audiense adapter for [`@absolutejs/audience`](https://www.npmjs.com/package/@absolutejs/audience).
Implements the `AudienceSource` contract against the [Audiense Insights API](https://api.audiense.com)
— reports, demographics, influencer/brand affinities, and audience overlap — so an
AbsoluteJS app can use **measured** audience intelligence wherever it otherwise
derives it (e.g. the Trust & Fit / OPA audience-overlap signal).

This is the premium social-graph backfill: the parts of audience intelligence you
can't derive yourself (Audiense's proprietary follower/affinity graph), behind the
same interface as the own-it primitives.

## Install

```sh
bun add @absolutejs/audience-audiense @absolutejs/audience
```

## Use

```ts
import { audienseSource } from "@absolutejs/audience-audiense";

const audience = audienseSource({
  clientId: process.env.AUDIENSE_CLIENT_ID!,
  clientSecret: process.env.AUDIENSE_CLIENT_SECRET!,
  defaultBaselineId: process.env.AUDIENSE_BASELINE_ID, // baseline to compare affinities against
});

const reports = await audience.listAudiences?.();
const profile = await audience.getAudience?.(reports![0]);   // size, segments, demographics, affinities
const overlap = await audience.overlap?.(reportA, reportB);  // { score, sharedAffinities, method }
```

Every method is optional on `AudienceSource`, so consumers feature-detect:

```ts
const score = audience.overlap
  ? (await audience.overlap(a, b)).score   // measured, from Audiense
  : affinityOverlap(profA, profB).score;   // derived fallback (@absolutejs/audience)
```

## Auth

Client-credentials OAuth: `POST {baseUrl}/login/token` with
`Authorization: Basic base64(clientId:clientSecret)` and `grant_type=client_credentials`.
The returned bearer token is cached until just before it expires. Get credentials
from your Audiense account (or your Audiense data-partnership contact).

## Config

| Field | Default | Notes |
| --- | --- | --- |
| `clientId` / `clientSecret` | — | Audiense API credentials (required). |
| `baseUrl` | `https://api.audiense.com/v1` | Override for a partnership/sandbox feed. |
| `defaultBaselineId` | — | Baseline audience to compare affinities against; override per call via a ref's `meta.baselineId`. |
| `fetch` | global `fetch` | Inject for tests / custom runtimes. |
| `now` | `Date.now` | Inject a clock for tests. |

## Overlap

Audiense exposes no two-audience intersection endpoint at the API tier this adapter
targets (it's a UI report), so `overlap` is computed from **shared affinities**
(`affinityItemsOverlap` from `@absolutejs/audience` — a weighted cosine over the two
affinity graphs, plus the shared items). If your data partnership grants a native
intersection endpoint, swap it in at the `overlap` implementation.

## Field-mapping note

Response shapes are modeled from Audiense's own official client
([`audienseco/mcp-audiense-insights`](https://github.com/audienseco/mcp-audiense-insights)).
A few field names weren't public, so the types are tolerant and the mappers degrade
gracefully when a field is absent. Confirm exact field names against the live API (or
your partnership feed) — the mappers are centralized in `src/index.ts`.

## License

Apache-2.0. It only has value riding `@absolutejs/audience`, so it's permissive (per
the AbsoluteJS adapter-tier policy).
