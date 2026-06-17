# news

**A personal news aggregator that pulls primary sources — company newsrooms,
investor-relations feeds, SEC filings, and science — into one fresh, fast feed.**

▶ **Live:** [news.cuteteal.com](https://news.cuteteal.com)

![The public feed at news.cuteteal.com](docs/screenshot.png)

Built by **Connor Couetil** — [GitHub](https://github.com/couetilc) ·
[LinkedIn](https://www.linkedin.com/in/connorcouetil). A solo
project: the product thesis, the architecture, and the agent-driven build
workflow are all mine.

## Try it (no install)

Open **[news.cuteteal.com](https://news.cuteteal.com)** — the public feed is
read-only and needs no signup, so you can experience the product without cloning
anything. You're seeing the same server-rendered feed the app serves to its
single signed-in reader, minus the personal read/unread state. (For a developer
setup, see [Quickstart](#quickstart) below.)

## What this is

A single-user news aggregator built for one reader, and a working portfolio
piece. It skips the engagement-optimized middlemen and reads primary sources
directly: tech-company newsrooms (Apple, NVIDIA, Intel, AMD, Qualcomm, Cisco, …),
investor-relations and earnings feeds, SEC EDGAR 8-K filings, and science wires —
all rendered server-side as a clean, newspaper-styled feed.

It runs entirely on Cloudflare's edge, and — notably — it's built almost entirely
by AI coding agents working a disciplined, test-gated workflow.

## Highlights — and why

Each line is a decision, not just a feature:

- **Reads primary sources, not aggregator middlemen.** The product bet: less
  engagement-optimized noise, more signal. Tech-company newsrooms, IR and
  earnings feeds, SEC EDGAR 8-K filings, and science wires, all normalized into
  one feed.
- **Astro 6 SSR on Cloudflare Workers, with local dev inside workerd.** Chose
  edge server-rendering because a news feed wants fresh content over a stale
  cache, and local-workerd parity so "works on my machine" actually means "works
  in production."
- **Multi-source ingestion into D1, sessions on KV.** Each source type
  (RSS/Atom, JSON APIs, SEC EDGAR) gets its own adapter feeding one normalized
  schema — adding a feed is a small, contained change, not a rewrite.
- **100% hermetic test gate.** Every statement, branch, function, and line is
  covered, and the suite never touches the network — so it's green in CI,
  offline, and in sandboxed agent sessions alike. Discipline a teammate can
  trust, not a vanity metric.
- **Merge to deploy.** Branch → PR → green checks → live, with no manual release
  step to forget or get wrong.

## Built by AI coding agents

This repo is also an experiment: nearly every change ships through AI coding
agents running a real, test-gated engineering workflow rather than ad-hoc
prompting. The interesting part isn't that an LLM wrote code — it's the system
of guardrails that lets it ship safely without a human in every loop.

- **Two agents in parallel.** One loop drives the GitHub-issue backlog —
  implement on a branch, open a PR, merge once CI is green; a second reviews each
  merged PR and files its findings back as new issues. The roles are
  model-neutral, and a human signs off on the architectural, security, and README
  tier.
- **One shared instruction layer across four surfaces** — local CLI, Claude
  Dispatch, claude.ai cloud sessions, and GitHub Actions all read the same
  [`CLAUDE.md`](CLAUDE.md) and [`.claude/skills/`](.claude/skills).
- **Isolation by default.** `./bin/claude` runs an agent full-auto inside a
  container that clones the repo fresh, so parallel agents never collide, and
  nothing reaches production except through a reviewed PR and green CI.

The conventions, skills, and launcher details that keep this safe live in
[`CLAUDE.md`](CLAUDE.md) and [`.claude/skills/`](.claude/skills).

## Architecture

- The **`@astrojs/cloudflare` adapter** emits the Worker + assets;
  `wrangler.jsonc` is the single source of infra truth (routes, bindings, the
  custom domain).
- **SSR by default** — an aggregator serves fresh content; individual pages opt
  back into prerendering.
- **D1** for items, **KV** for sessions, build-time image optimization.

The full rationale for each choice lives in [`CLAUDE.md`](CLAUDE.md).

## Quickstart

```bash
nvm install 24      # node 24 via your version manager of choice
npm install
npm run dev         # http://localhost:4321, running in workerd
```

(Install node 24 on host machines with whatever version manager you use — the
agent container and cloud sessions provision node automatically.)

## Testing

`npm test` runs **two vitest projects** — one inside the **workerd** pool (real
D1, real `cloudflare:workers` bindings) and one in **node** (Astro page
rendering) — behind a merged **100% statements / branches / functions / lines
coverage gate** over `src/**`.
Tests are fixture-driven and **never hit the network**, so the suite behaves
identically in CI, in cloud sessions, and offline. Browser/e2e checks
(Playwright) run as a separate entry point.

```bash
npm test            # vitest; fails below 100% statements/branches/functions/lines coverage
```

## Deploy

Merging a PR to `main` deploys via GitHub Actions — the canonical path. Manual
fallback from a host machine:

```bash
npm run deploy      # astro build && wrangler deploy
```

Auth for the fallback: `npx wrangler login`, or copy `.env.example` to `.env`
and fill in `CLOUDFLARE_API_TOKEN` (see `.env.example` for exact token scopes —
it is the living documentation for all credentials).

## A product demoing the Cloudflare Developer Platform

A small but complete product built end-to-end on Cloudflare's developer stack: an
Astro SSR app running on Workers (workerd), D1 for the article store, R2 for a
public asset CDN, and KV-backed sessions — wired together with merge-to-deploy CI.
It's meant to show the platform doing real work, not a toy.

## Learn more

- [`CLAUDE.md`](CLAUDE.md) — architecture decisions and the full command
  reference.
- [`.claude/skills/`](.claude/skills) — the agent skills (design system, testing
  policy, issue orchestration, agentic environments).
- [`.env.example`](.env.example) — credential and token-scope documentation.
