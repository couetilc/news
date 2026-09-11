// node experiments/verify-feed-repairs.mjs
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, server: { middlewareMode: true }, logLevel: 'silent' });
try {
	const { probe } = await vite.ssrLoadModule('/experiments/feed-repairs-probe.ts');
	for (const source of ['intel', 'owenomics', 'deepseek']) console.log(JSON.stringify(await probe(source), null, 2));
} finally {
	await vite.close();
}
