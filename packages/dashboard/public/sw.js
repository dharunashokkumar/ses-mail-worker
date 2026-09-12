/*
 * Offline support.
 *
 * The app shell and its assets are cached so the mail opens with no network;
 * API reads fall back to the last response seen. Writes are never cached — the
 * app keeps unsent mail in its own outbox and retries when the network is back.
 */

const SHELL_CACHE = "mail-shell-v1";
const ASSET_CACHE = "mail-assets-v1";
const API_CACHE = "mail-api-v1";
const SHELL_URLS = ["/", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(SHELL_CACHE)
			.then((cache) => cache.addAll(SHELL_URLS))
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => ![SHELL_CACHE, ASSET_CACHE, API_CACHE].includes(key))
						.map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

async function cacheFirst(request, cacheName) {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	if (response.ok) cache.put(request, response.clone());
	return response;
}

async function networkFirst(request, cacheName, fallback) {
	const cache = await caches.open(cacheName);
	try {
		const response = await fetch(request);
		if (response.ok) cache.put(request, response.clone());
		return response;
	} catch (error) {
		const hit = await cache.match(request);
		if (hit) return hit;
		if (fallback) {
			const shell = await caches.open(SHELL_CACHE);
			const shellHit = await shell.match(fallback);
			if (shellHit) return shellHit;
		}
		throw error;
	}
}

// The app tells the worker when the signed-in identity changes, because cached
// API answers belong to whoever was signed in when they were stored.
self.addEventListener("message", (event) => {
	if (event.data?.type === "clear-api-cache") {
		event.waitUntil(caches.delete(API_CACHE));
	}
});

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") return;

	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	// Live updates and attachment downloads go straight to the network, and so
	// does the identity endpoint: a stale answer there would show the wrong
	// account as signed in.
	if (
		url.pathname.endsWith("/live") ||
		url.pathname.includes("/attachments/") ||
		url.pathname === "/api/v1/identity"
	) {
		return;
	}

	if (request.mode === "navigate") {
		event.respondWith(networkFirst(request, SHELL_CACHE, "/"));
		return;
	}

	if (url.pathname.startsWith("/api/")) {
		event.respondWith(networkFirst(request, API_CACHE));
		return;
	}

	if (url.pathname.startsWith("/assets/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
		event.respondWith(cacheFirst(request, ASSET_CACHE));
	}
});
