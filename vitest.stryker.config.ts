import { defineConfig } from 'vitest/config';
import { MUTATION_TESTS } from './test/mutation-scope.ts';

// Mutation replays only pure node specs; runtime parity stays in the worker project.
export default defineConfig({
	test: { name: 'stryker', environment: 'node', include: MUTATION_TESTS },
});
