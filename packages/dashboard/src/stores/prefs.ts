/**
 * Everything about how the mail looks and behaves for this person.
 *
 * Kept in localStorage so the first paint is right, and mirrored to the
 * mailbox's server-side preferences so a second device picks them up.
 */

import { defineStore } from "pinia";
import { mailApi } from "@/services/mail";

export type ThemeChoice = "light" | "dark" | "system";
export type Density = "compact" | "cozy" | "relaxed";
export type PanePosition = "right" | "bottom" | "off";
export type SwipeAction = "archive" | "trash" | "snooze" | "flag" | "read";

export interface Preferences {
	theme: ThemeChoice;
	accent: string;
	density: Density;
	pane: PanePosition;
	conversations: boolean;
	swipeRight: SwipeAction;
	swipeLeft: SwipeAction;
	undoSeconds: number;
	signature: string;
	signatureEnabled: boolean;
	aiEnabled: boolean;
	notifications: boolean;
}

const STORAGE_KEY = "mail:preferences";

export const ACCENTS = [
	{ id: "#2b74e8", name: "Blue" },
	{ id: "#0f766e", name: "Teal" },
	{ id: "#12a150", name: "Green" },
	{ id: "#d97706", name: "Amber" },
	{ id: "#e5484d", name: "Red" },
	{ id: "#a45cd6", name: "Purple" },
	{ id: "#475569", name: "Graphite" },
];

const DEFAULTS: Preferences = {
	theme: "system",
	accent: "#2b74e8",
	density: "cozy",
	pane: "right",
	conversations: true,
	swipeRight: "read",
	swipeLeft: "archive",
	undoSeconds: 10,
	signature: "",
	signatureEnabled: false,
	aiEnabled: true,
	notifications: false,
};

function load(): Preferences {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
	} catch {
		return { ...DEFAULTS };
	}
}

export const usePrefsStore = defineStore("prefs", {
	state: () => ({
		prefs: load(),
		syncedMailbox: "" as string,
	}),
	actions: {
		apply() {
			const root = document.documentElement;
			if (this.prefs.theme === "system") root.removeAttribute("data-theme");
			else root.setAttribute("data-theme", this.prefs.theme);
			root.style.setProperty("--accent", this.prefs.accent);
			root.setAttribute("data-density", this.prefs.density);
			try {
				localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
			} catch {
				// private mode: the defaults are fine
			}
		},

		set<K extends keyof Preferences>(key: K, value: Preferences[K]) {
			this.prefs[key] = value;
			this.apply();
			void this.push();
		},

		async hydrate(mailboxId: string) {
			this.syncedMailbox = mailboxId;
			this.apply();
			try {
				const remote = await mailApi.preferences(mailboxId);
				if (remote && Object.keys(remote).length > 0) {
					this.prefs = { ...this.prefs, ...remote };
					this.apply();
				}
			} catch {
				// offline, or a mailbox with nothing saved yet
			}
		},

		async push() {
			if (!this.syncedMailbox) return;
			try {
				await mailApi.savePreferences(this.syncedMailbox, { ...this.prefs });
			} catch {
				// queued changes are not worth retrying: the local copy is the truth
			}
		},
	},
});
