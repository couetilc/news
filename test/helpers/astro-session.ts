// Exercise the installed framework's actual serialization, dirty flag and cookie
// behavior. Internal imports stay confined to this test adapter, never app code.
import { AstroSession, PERSIST_SYMBOL } from '../../node_modules/astro/dist/core/session/runtime.js';
import { AstroCookies } from '../../node_modules/astro/dist/core/cookies/cookies.js';
import { AstroLogger } from '../../node_modules/astro/dist/core/logger/core.js';
import type { SessionDriverFactory } from '../../node_modules/astro/dist/core/session/types.js';

export { PERSIST_SYMBOL };

export function testSession(driver: SessionDriverFactory, driverId: string, id?: string) {
	const cookies = new AstroCookies(new Request('https://news.test/', { headers: id ? { Cookie: `astro-session=${id}` } : {} }));
	const session = new AstroSession({
		cookies, runtimeMode: 'production',
		config: { driver: driverId, cookie: { maxAge: 1209600, sameSite: 'lax' }, ttl: 1296000 },
		driverFactory: driver, mockStorage: null,
		logger: new AstroLogger({ level: 'silent', destination: { write() {} } }),
	});
	return { session, cookies };
}
