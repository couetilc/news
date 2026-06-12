# news

Personal news aggregator, served at [news.cuteteal.com](https://news.cuteteal.com)
on Cloudflare Workers. Built with Astro (SSR) on the `@astrojs/cloudflare`
adapter; local dev runs inside workerd for production parity.

## Quickstart

```bash
mise install        # node 24 (also auto-loads .env into project shells)
npm install
npm run dev         # http://localhost:4321, running in workerd
```

(`mise install` is for host machines — the agent container and claude.ai
cloud sessions provision node automatically.)

## Test

```bash
npm test            # vitest; fails below 100% line/branch coverage
```

## Deploy

Merging a PR to `main` deploys via GitHub Actions — that's the canonical
path. Manual fallback from a host machine:

```bash
npm run deploy      # astro build && wrangler deploy
```

Auth for the fallback: `npx wrangler login`, or copy `.env.example` to `.env`
and fill in `CLOUDFLARE_API_TOKEN` (see `.env.example` for exact token
scopes — it is the living documentation for all credentials).

See `CLAUDE.md` for architecture decisions and the full command reference.
