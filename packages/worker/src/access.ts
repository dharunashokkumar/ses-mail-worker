/**
 * Cloudflare Access as the front door.
 *
 * With `AUTH_MODE=access` the Worker trusts the signed Access JWT instead of
 * the built-in login: Access does the authentication at the edge and we only
 * verify its signature here. The JWKS is cached per isolate, so a normal
 * request costs no subrequest and only a signature verification of CPU.
 */

import type { Session } from "./types";

interface Jwk {
	kid: string;
	kty: string;
	alg?: string;
	n: string;
	e: string;
}

interface CachedKeys {
	keys: Jwk[];
	expiresAt: number;
}

const KEY_CACHE = new Map<string, CachedKeys>();
const KEY_TTL_MS = 60 * 60 * 1000;

function base64UrlToBytes(value: string): Uint8Array {
	const padded = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(
		padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="),
	);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function decodeJson(part: string): Record<string, any> {
	return JSON.parse(new TextDecoder().decode(base64UrlToBytes(part)));
}

function teamUrl(teamDomain: string): string {
	const host = teamDomain.replace(/^https?:\/\//, "").replace(/\/$/, "");
	return `https://${host}`;
}

async function getKeys(teamDomain: string): Promise<Jwk[]> {
	const url = `${teamUrl(teamDomain)}/cdn-cgi/access/certs`;
	const cached = KEY_CACHE.get(url);
	if (cached && cached.expiresAt > Date.now()) return cached.keys;

	const response = await fetch(url, { cf: { cacheTtl: 3600 } });
	if (!response.ok)
		throw new Error(`Access certs request failed: ${response.status}`);
	const body = (await response.json()) as { keys?: Jwk[] };
	const keys = body.keys ?? [];
	KEY_CACHE.set(url, { keys, expiresAt: Date.now() + KEY_TTL_MS });
	return keys;
}

/** The Access token, from the header Access sets or the cookie it drops. */
export function getAccessToken(request: Request): string | null {
	const header = request.headers.get("Cf-Access-Jwt-Assertion");
	if (header) return header;
	const cookie = request.headers.get("Cookie");
	const match = cookie?.match(/CF_Authorization=([^;]+)/);
	return match ? match[1] : null;
}

export interface AccessIdentity {
	email: string;
	subject: string;
	expiresAt: number;
}

/** Verify an Access JWT. Returns null when it is missing, expired or not ours. */
export async function verifyAccessToken(
	token: string,
	options: { teamDomain: string; audience: string },
): Promise<AccessIdentity | null> {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	let header: Record<string, any>;
	let payload: Record<string, any>;
	try {
		header = decodeJson(parts[0]);
		payload = decodeJson(parts[1]);
	} catch {
		return null;
	}

	if (header.alg !== "RS256") return null;

	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== "number" || payload.exp < now) return null;
	if (typeof payload.nbf === "number" && payload.nbf > now + 60) return null;

	const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
	if (!audience.includes(options.audience)) return null;
	if (
		typeof payload.iss === "string" &&
		!payload.iss.startsWith(teamUrl(options.teamDomain))
	) {
		return null;
	}

	const keys = await getKeys(options.teamDomain);
	const jwk = keys.find((key) => key.kid === header.kid);
	if (!jwk) return null;

	const publicKey = await crypto.subtle.importKey(
		"jwk",
		{ kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"],
	);
	const valid = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		publicKey,
		base64UrlToBytes(parts[2]),
		new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
	);
	if (!valid) return null;

	const email = String(
		payload.email ?? payload.common_name ?? "",
	).toLowerCase();
	if (!email) return null;

	return {
		email,
		subject: String(payload.sub ?? email),
		expiresAt: payload.exp * 1000,
	};
}

/** True when this deployment is fronted by Cloudflare Access. */
export function usesAccess(env: {
	AUTH_MODE?: string;
	ACCESS_AUD?: string;
	ACCESS_TEAM_DOMAIN?: string;
}): boolean {
	return (
		env.AUTH_MODE?.trim().toLowerCase() === "access" &&
		Boolean(env.ACCESS_AUD?.trim()) &&
		Boolean(env.ACCESS_TEAM_DOMAIN?.trim())
	);
}

/**
 * The session an Access-authenticated request runs as. There is one human
 * behind Access, so they are the admin of their own mail.
 */
export async function sessionFromAccess(
	request: Request,
	env: { ACCESS_AUD?: string; ACCESS_TEAM_DOMAIN?: string },
): Promise<Session | null> {
	const token = getAccessToken(request);
	if (!token) return null;
	const identity = await verifyAccessToken(token, {
		teamDomain: env.ACCESS_TEAM_DOMAIN ?? "",
		audience: env.ACCESS_AUD ?? "",
	});
	if (!identity) return null;
	return {
		id: `access:${identity.subject}`,
		userId: `access:${identity.subject}`,
		email: identity.email,
		isAdmin: true,
		expiresAt: identity.expiresAt,
	};
}
