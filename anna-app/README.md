# Anna.ai — the app

The working implementation of the Anna.ai case study in the parent directory.

Research, personas, journey maps, and the hi-fi prototype live at the repo root.
This folder is the product those artefacts describe, built for real: live travel
APIs, a grounded LLM planning loop, and real-time group collaboration.

---

## What it does

A group of friends describes a trip, gets a plan with real prices, shares one
link, and their friends change it.

That loop is the whole product. Everything in here serves it.

---

## The core principle

**The model is the narrator, not the source.**

Anna never states a price, a flight time, availability, opening hours, or a
travel duration that did not come from a tool call. Facts come from APIs;
language comes from the model. Three ideas enforce that rather than merely
hoping for it:

| Layer | What it does |
| --- | --- |
| `source` / `source_ref` / `verified_at` columns | An itinerary item with `verified_at = null` renders as a *suggestion*, never as a fact |
| The three gates | Feasibility, budget, and grounding are checked in code before anything reaches the user |
| `propose_itinerary` | The model proposes; it never writes to the database directly |

The model also refuses visa, entry, and travel-safety questions outright and
points at an official source — being right by luck is still a policy failure.

---

## Stack

| Piece | Choice | Why |
| --- | --- | --- |
| Framework | Next.js (App Router) | Native streaming for the SSE planning endpoint; server routes hold every key |
| Database / auth / realtime | Supabase | Postgres + magic-link auth + Realtime in one free tier; RLS enforces trip access |
| Model | Claude (Anthropic) | Tool-use loop with streaming |
| Styling | Tailwind v4 | CSS-first config in `app/globals.css` |

---

## Setup

### 1. Credentials

Copy `.env.example` to `.env` and fill it in. **Only Anthropic needs a credit
card** — everything else here has a genuine free tier with no card required.

| Service | Gives you | Card? |
| --- | --- | --- |
| [Anthropic](https://console.anthropic.com) | The conversational core | Yes |
| [Supabase](https://supabase.com) | Postgres, auth, realtime | No |
| [Amadeus Self-Service](https://developers.amadeus.com) | Flights, hotels, IATA lookup | No |
| [OpenRouteService](https://openrouteservice.org) | Travel time (feasibility gate) | No |
| [OpenTripMap](https://opentripmap.io) | Real points of interest | No |
| [Unsplash](https://unsplash.com/developers) | Destination imagery | No |
| Open-Meteo | Weather | No key at all |
| Frankfurter | Currency conversion | No key at all |

Set a **$50 spend cap** in the Anthropic console while you are there. Expected
spend across the whole build is $20–30.

**Apply to [Travelpayouts](https://travelpayouts.com) on day one.** It is the
affiliate network behind the booking handoff, it approves individual
developers where Booking.com's direct programme generally will not, and
approval takes days to weeks. Until it clears, the handoff deep-links without
an affiliate ID — the flow works, it just earns nothing.

> Note: Google Flights has **no public API**. QPX Express was retired in 2018
> and nothing replaced it. Amadeus and Duffel are the real options.

### 2. Run it

```sh
npm install
npm run dev
```

The landing page is a credential check — it shows which keys are in place and
which signups you still owe. It is replaced by the real app once auth lands.

```sh
npm run typecheck   # tsc --noEmit
npm run build       # production build
npm run eval        # the eight-case reliability suite
```

### 3. Provider modes

`PROVIDER_MODE` in `.env` controls where travel data comes from:

| Mode | Behaviour |
| --- | --- |
| `live` | Call the real APIs. The default, and how you develop |
| `record` | Call them, and snapshot each response into `fixtures/` |
| `replay` | Serve from `fixtures/` — no network, no cost, deterministic |

`replay` exists for two reasons: the test suite runs without burning quota, and
a demo recording cannot be broken by an API having a bad afternoon. You can
only build the replay half because you did the live half first.

---

## Layout

```
anna-app/
  app/                    routes and UI
    page.tsx              credential-status page (temporary)
    globals.css           Tailwind v4 theme tokens
  lib/
    env.ts                typed env access; providers validated at call time
  supabase/
    migrations/           schema and row-level security
  scripts/
    eval.ts               the reliability suite
```

---

## Reliability

The eight-case eval suite in `scripts/eval.ts` asserts on the things that
matter and is meant to be run before any recording or demo:

| Metric | Target |
| --- | --- |
| Grounding rate — factual claims traceable to a tool result | ≥ 99% |
| Itinerary feasibility — travel times physically possible | ≥ 95% |
| Budget adherence — within stated budget or explicitly flagged | ≥ 90% |
| Refusal correctness — visa and safety questions declined | 100% |

Two cases are worth reading first: the visa question it must **refuse**, and
the group-budget conflict it must **surface** rather than silently average.

---

## Status

Early build. See the task list in the working session for what is done and what
is next. Nothing here has been used by a real group yet — the concierge test
that would validate the core thesis has not been run.
