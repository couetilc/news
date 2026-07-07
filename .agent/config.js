// .agent/config.js — this project's agent-container configuration.
// USER-OWNED: `agent init` writes this once and never overwrites it. Pure data
// (no functions in v1); loaded as ESM and validated by @couetilc/agentic-coding.
export default {
  schemaVersion: 1,

  project: 'news',                  // names image, containers, volumes, labels
  repo: 'couetilc/news',            // clone target (HTTPS + GH_TOKEN)
  defaultBranch: 'main',            // auto-push hook skips this branch

  // Named container ports → host mapping. Each gets a fresh random localhost
  // port per launch, injected as $DEV_HOST_<NAME>. news runs two dev servers:
  //   astro    → $DEV_HOST_ASTRO     (was $DEV_HOST_4321 in the old launcher)
  //   wrangler → $DEV_HOST_WRANGLER  (was $DEV_HOST_8787)
  // Bind each to 0.0.0.0 inside (e.g. `npm run dev -- --host`) to be reachable.
  ports: { astro: 4321, wrangler: 8787 },

  agents: {
    claude: { model: 'claude-fable-5', effort: 'xhigh' },
    codex:  { model: 'gpt-5.5',        effort: 'xhigh' },
  },

  // .env keys the preflight requires beyond GH_TOKEN + agent credentials.
  // Empty on purpose: the agent container tests + pushes branches; CI deploys
  // with CLOUDFLARE_API_TOKEN, so a container launch must NOT require it (news's
  // isolation contract keeps the cloud/agent surface deliberately deploy-creds-free).
  requiredEnv: [],

  // Extra named docker volumes mounted for cross-container caching. The npm
  // cache is always mounted; uv persists the Python-tooling cache (base ships uv).
  caches: ['uv'],
};
