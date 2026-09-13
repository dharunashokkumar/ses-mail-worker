import { EmailMessage } from "cloudflare:email";
import { AwsClient } from "aws4fetch";
import { buildMimeMessage } from "./mime-builder";
import {
	buildSesSendEmailRequest,
	getSesErrorMessage,
	getSesMessageIdDomain,
	type OutboundAttachment,
	type OutboundEmail,
} from "./ses-utils";
import type { Env } from "./types";

/** What the routes pass: their zod-inferred attachment types mark every field optional. */
type OutboundEmailInput = Omit<OutboundEmail, "attachments"> & {
	attachments?: Partial<OutboundAttachment>[];
};

/**
 * Sends through Amazon SES when `EMAIL_PROVIDER` is `ses`, otherwise through the
 * send_email binding. Resolves to the Message-ID recipients see, when it is known.
 */
export async function sendOutboundEmail(
	env: Env,
	input: OutboundEmailInput,
): Promise<{ messageId: string | null }> {
	const message: OutboundEmail = {
		...input,
		attachments: input.attachments?.map((attachment) => ({
			filename: attachment.filename ?? "attachment",
			content: attachment.content ?? "",
			type: attachment.type ?? "application/octet-stream",
			disposition: attachment.disposition,
			contentId: attachment.contentId,
		})),
	};

	if (env.EMAIL_PROVIDER?.trim().toLowerCase() === "ses") {
		return sendWithSes(env, message);
	}

	// The binding takes a single envelope recipient, so every address — To, Cc
	// and Bcc alike — gets its own copy. Bcc addresses stay out of the headers,
	// so the copies look the way they should.
	const recipients = [
		...(Array.isArray(message.to) ? message.to : [message.to]),
		...(message.cc ?? []),
		...(message.bcc ?? []),
	]
		.map((address) => address?.trim())
		.filter(Boolean);
	if (recipients.length === 0) throw new Error("No recipient to send to");

	const mime = buildMimeMessage(message);
	for (const recipient of recipients) {
		await env.SEND_EMAIL.send(new EmailMessage(message.from, recipient, mime));
	}
	return { messageId: null };
}

async function sendWithSes(
	env: Env,
	message: OutboundEmail,
): Promise<{ messageId: string }> {
	const region = env.AWS_SES_REGION?.trim();
	const accessKeyId = env.AWS_ACCESS_KEY_ID?.trim();
	const secretAccessKey = env.AWS_SECRET_ACCESS_KEY?.trim();
	if (!region || !accessKeyId || !secretAccessKey) {
		throw new Error(
			"Amazon SES is not configured. Set AWS_SES_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.",
		);
	}

	const client = new AwsClient({
		accessKeyId,
		secretAccessKey,
		service: "ses",
		region,
		// Repeating a send SES may already have accepted would deliver it twice.
		retries: 0,
	});
	const request = buildSesSendEmailRequest(message, {
		configurationSetName: env.AWS_SES_CONFIGURATION_SET?.trim() || null,
	});
	const response = await client.fetch(
		`https://email.${region}.amazonaws.com/v2/email/outbound-emails`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(request),
		},
	);
	if (!response.ok) {
		throw new Error(
			getSesErrorMessage(
				response.status,
				response.headers.get("x-amzn-ErrorType"),
				await response.text(),
			),
		);
	}

	const { MessageId } = (await response.json()) as { MessageId?: string };
	if (!MessageId) throw new Error("Amazon SES returned no MessageId");
	// SES replaces Message-ID with <id@domain>. Store it bare, as receiveEmail stores
	// the IDs replies carry, so a reply to this message lands in its thread.
	const domain =
		env.AWS_SES_MESSAGE_ID_DOMAIN?.trim() || getSesMessageIdDomain(region);
	return { messageId: `${MessageId}@${domain}` };
}
