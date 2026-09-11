export interface EmailExplorerOptions {
	auth?: {
		enabled?: boolean;
		registerEnabled?: boolean;
	};
	accountRecovery?: {
		fromEmail: string;
	};
}

export interface Session {
	id: string;
	userId: string;
	email: string;
	isAdmin: boolean;
	expiresAt: number;
}

export interface User {
	id: string;
	email: string;
	isAdmin: boolean;
	createdAt: number;
	updatedAt: number;
}

export type Env = {
	MAILBOX: DurableObjectNamespace<import("./durableObject/index").MailboxDO>;
	BUCKET: R2Bucket;
	SEND_EMAIL: SendEmail;
	/** Workers AI, used for summaries and rewrites. Optional: the UI hides them when absent. */
	AI?: { run: (model: string, input: Record<string, any>) => Promise<any> };
	config?: EmailExplorerOptions;
	/** `ses` sends through Amazon SES instead of the SEND_EMAIL binding. */
	EMAIL_PROVIDER?: string;
	AWS_SES_REGION?: string;
	AWS_ACCESS_KEY_ID?: string;
	AWS_SECRET_ACCESS_KEY?: string;
	AWS_SES_CONFIGURATION_SET?: string;
	AWS_SES_MESSAGE_ID_DOMAIN?: string;
	/** `access` trusts the Cloudflare Access JWT instead of the built-in login. */
	AUTH_MODE?: string;
	/** Access application audience (AUD) tag, required when AUTH_MODE is `access`. */
	ACCESS_AUD?: string;
	/** Access team domain, e.g. `dharun.cloudflareaccess.com`. */
	ACCESS_TEAM_DOMAIN?: string;
	/** Shared secret an SES/SNS webhook must present as `?token=`. */
	SES_WEBHOOK_TOKEN?: string;
	/** Cloudflare API token allowed to manage Email Routing rules for the domain. */
	CLOUDFLARE_API_TOKEN?: string;
	CLOUDFLARE_ZONE_ID?: string;
	/** Domain new addresses are created on, e.g. `dharun.dev`. */
	MAIL_DOMAIN?: string;
};
