// Stub for the `cloudflare:workers` module in the node test project (aliased in
// vitest.node.config.ts). The homepage imports `env` from here; tests that
// render the page mock the data layer, so this only needs to exist.
export const env: Record<string, unknown> = {};
