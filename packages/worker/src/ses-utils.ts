// Pure helpers for sending through Amazon SES. No Workers runtime imports, so
// they can be unit tested without bindings.

export type OutboundAttachment = {
	filename: string;
	/** Base64-encoded content. */
	content: string;
	type: string;
	disposition?: "attachment" | "inline";
	contentId?: string;
};

export type OutboundEmail = {
	from: string;
	to: string | string[];
	subject: string;
	text?: string;
	html?: string;
	attachments?: OutboundAttachment[];
	/** Message-ID of the message being replied to, without angle brackets. */
	inReplyTo?: string;
	/** The conversation's Message-IDs, oldest first, without angle brackets. */
	references?: string[];
};

type SesText = { Data: string; Charset: "UTF-8" };

export type SesAttachment = {
	RawContent: string;
	ContentDisposition: "ATTACHMENT" | "INLINE";
	ContentId?: string;
	ContentTransferEncoding: "BASE64";
	ContentType: string;
	FileName: string;
};

/** SES API v2 SendEmail with Simple content: SES assembles and encodes the MIME itself. */
export type SesSendEmailRequest = {
	FromEmailAddress: string;
	Destination: { ToAddresses: string[] };
	Content: {
		Simple: {
			Subject: SesText;
			Body: { Text?: SesText; Html?: SesText };
			Headers?: { Name: string; Value: string }[];
			Attachments?: SesAttachment[];
		};
	};
	ConfigurationSetName?: string;
};

// SES caps a custom header value at 995 characters, and name plus value at 996.
const SES_MAX_HEADER_LENGTH = 996;

/** A `<id>` list that fits SES's header limit: the root plus the most recent ancestors. */
export function formatMessageIdList(ids: string[], headerName: string): string {
	const maxLength = Math.min(
		SES_MAX_HEADER_LENGTH - 1,
		SES_MAX_HEADER_LENGTH - headerName.length,
	);
	const formatted = ids
		.map((id) => id.replace(/[\s<>]/g, ""))
		.filter(Boolean)
		.map((id) => `<${id}>`);
	const joined = formatted.join(" ");
	if (joined.length <= maxLength || formatted.length < 2) return joined;

	const [root, ...rest] = formatted;
	const recent: string[] = [];
	let length = root.length;
	for (let index = rest.length - 1; index >= 0; index -= 1) {
		if (length + 1 + rest[index].length > maxLength) break;
		recent.unshift(rest[index]);
		length += 1 + rest[index].length;
	}
	return [root, ...recent].join(" ");
}

export function buildSesSendEmailRequest(
	message: OutboundEmail,
	options: { configurationSetName?: string | null } = {},
): SesSendEmailRequest {
	const utf8 = (data: string): SesText => ({ Data: data, Charset: "UTF-8" });
	const body: SesSendEmailRequest["Content"]["Simple"]["Body"] = {};
	if (message.text) body.Text = utf8(message.text);
	if (message.html) body.Html = utf8(message.html);

	const headers: { Name: string; Value: string }[] = [];
	const inReplyTo = formatMessageIdList(
		message.inReplyTo ? [message.inReplyTo] : [],
		"In-Reply-To",
	);
	if (inReplyTo) headers.push({ Name: "In-Reply-To", Value: inReplyTo });
	const references = formatMessageIdList(
		message.references ?? [],
		"References",
	);
	if (references) headers.push({ Name: "References", Value: references });

	const attachments = (message.attachments ?? []).map(
		(attachment): SesAttachment => {
			const contentId =
				attachment.disposition === "inline"
					? attachment.contentId?.replace(/^<|>$/g, "")
					: undefined;
			return {
				RawContent: attachment.content.replace(/\s/g, ""),
				ContentDisposition: contentId ? "INLINE" : "ATTACHMENT",
				...(contentId ? { ContentId: contentId } : {}),
				ContentTransferEncoding: "BASE64",
				ContentType: attachment.type || "application/octet-stream",
				FileName: attachment.filename,
			};
		},
	);

	return {
		FromEmailAddress: message.from,
		// Every recipient goes in the envelope, unlike the send_email binding's single address.
		Destination: {
			ToAddresses: Array.isArray(message.to) ? message.to : [message.to],
		},
		Content: {
			Simple: {
				Subject: utf8(message.subject),
				Body: body,
				...(headers.length ? { Headers: headers } : {}),
				...(attachments.length ? { Attachments: attachments } : {}),
			},
		},
		...(options.configurationSetName
			? { ConfigurationSetName: options.configurationSetName }
			: {}),
	};
}

/** SES rewrites Message-ID as `<id@domain>`; us-east-1 predates the regional names. */
export function getSesMessageIdDomain(region: string): string {
	return region === "us-east-1"
		? "email.amazonses.com"
		: `${region}.amazonses.com`;
}

export function getSesErrorMessage(
	status: number,
	errorType: string | null,
	body: string,
): string {
	let detail = "";
	try {
		const parsed = JSON.parse(body) as {
			message?: string;
			Message?: string;
		} | null;
		detail = parsed?.message ?? parsed?.Message ?? "";
	} catch {
		detail = body.trim().slice(0, 300);
	}
	const type = errorType?.split(":")[0].trim() || `HTTP ${status}`;
	return `Amazon SES ${type}: ${detail || "request failed"}`;
}
