/**
 * Cached mail belongs to whoever was signed in when it was stored.
 *
 * One place clears it, so every path that ends a session — sign-out, a 401, a
 * change of identity — drops the same things.
 */

const CACHE_PREFIX = "mail:cache:";

export function clearCachedMail(): void {
	// The service worker holds cached API answers; it may not control this page
	// yet, so the message goes through the ready registration.
	try {
		navigator.serviceWorker?.ready
			.then((registration) => {
				registration.active?.postMessage({ type: "clear-api-cache" });
			})
			.catch(() => {});
	} catch {
		// no service worker in this browser
	}

	try {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
		}
	} catch {
		// storage blocked: there is nothing cached to clear
	}
}

export { CACHE_PREFIX };
