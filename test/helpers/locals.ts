// Component tests have no Worker context. Fail explicitly if a component starts
// depending on one; runtime behavior belongs in the workerd suite.
export function testLocals(values: Pick<App.Locals, 'userId'> = {}): App.Locals {
	return {
		...values,
		get cfContext(): ExecutionContext { throw new Error('No Worker context in component tests'); },
	};
}
