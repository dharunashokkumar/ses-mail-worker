import { describe, expect, it } from "vitest";
import {
	buildSesSendEmailRequest,
	formatMessageIdList,
	getSesErrorMessage,
	getSesMessageIdDomain,
} from "../../src/ses-utils";

describe("buildSesSendEmailRequest", () => {
	it("puts every recipient in the envelope", () => {
		const request = buildSesSendEmailRequest({
			from: "me@example.com",
			to: ["a@example.net", "b@example.net"],
			subject: "Hello",
			text: "plain",
			html: "<p>html</p>",
		});
		expect(request.FromEmailAddress).toBe("me@example.com");
		expect(request.Destination).toEqual({
			ToAddresses: ["a@example.net", "b@example.net"],
		});
		expect(request.Content.Simple.Body).toEqual({
			Text: { Data: "plain", Charset: "UTF-8" },
			Html: { Data: "<p>html</p>", Charset: "UTF-8" },
		});
		expect(request.Content.Simple.Headers).toBeUndefined();
		expect(request.ConfigurationSetName).toBeUndefined();
	});

	it("accepts a single recipient string", () => {
		const request = buildSesSendEmailRequest({
			from: "me@example.com",
			to: "a@example.net",
			subject: "Hi",
			text: "x",
		});
		expect(request.Destination.ToAddresses).toEqual(["a@example.net"]);
	});

	it("adds threading headers with angle brackets", () => {
		const request = buildSesSendEmailRequest({
			from: "me@example.com",
			to: "a@example.net",
			subject: "Re: Hello",
			text: "reply",
			inReplyTo: "parent@mail.example.net",
			references: ["root@mail.example.net", "<parent@mail.example.net>"],
		});
		expect(request.Content.Simple.Headers).toEqual([
			{ Name: "In-Reply-To", Value: "<parent@mail.example.net>" },
			{
				Name: "References",
				Value: "<root@mail.example.net> <parent@mail.example.net>",
			},
		]);
	});

	it("passes base64 attachments through and keeps a bare Content-ID for inline parts", () => {
		const request = buildSesSendEmailRequest(
			{
				from: "me@example.com",
				to: "a@example.net",
				subject: "Files",
				html: '<img src="cid:logo">',
				attachments: [
					{
						filename: "notes.txt",
						type: "text/plain",
						content: "aGVs\nbG8=",
						disposition: "attachment",
					},
					{
						filename: "logo.png",
						type: "image/png",
						content: "iVBORw==",
						disposition: "inline",
						contentId: "<logo>",
					},
				],
			},
			{ configurationSetName: "mail" },
		);
		const [notes, logo] = request.Content.Simple.Attachments ?? [];
		expect(notes).toEqual({
			RawContent: "aGVsbG8=",
			ContentDisposition: "ATTACHMENT",
			ContentTransferEncoding: "BASE64",
			ContentType: "text/plain",
			FileName: "notes.txt",
		});
		expect(logo).toEqual({
			RawContent: "iVBORw==",
			ContentDisposition: "INLINE",
			ContentId: "logo",
			ContentTransferEncoding: "BASE64",
			ContentType: "image/png",
			FileName: "logo.png",
		});
		expect(request.ConfigurationSetName).toBe("mail");
	});
});

describe("formatMessageIdList", () => {
	it("keeps the root and the newest ancestors within SES's header limit", () => {
		const ids = Array.from(
			{ length: 40 },
			(_, index) =>
				`${String(index).padStart(2, "0")}-${"x".repeat(30)}@mail.example.com`,
		);
		const value = formatMessageIdList(ids, "References");
		expect("References".length + value.length).toBeLessThanOrEqual(996);

		const kept = value.split(" ");
		expect(kept.length).toBeGreaterThan(2);
		expect(kept.length).toBeLessThan(ids.length);
		expect(kept[0]).toBe(`<${ids[0]}>`);
		expect(kept.slice(1)).toEqual(
			ids.slice(ids.length - (kept.length - 1)).map((id) => `<${id}>`),
		);
	});

	it("drops empty ids and stray whitespace", () => {
		expect(formatMessageIdList(["", " a@x ", "b@x\r\n"], "References")).toBe(
			"<a@x> <b@x>",
		);
	});
});

describe("SES naming and errors", () => {
	it("uses the regional Message-ID domain outside us-east-1", () => {
		expect(getSesMessageIdDomain("us-east-1")).toBe("email.amazonses.com");
		expect(getSesMessageIdDomain("ap-south-1")).toBe(
			"ap-south-1.amazonses.com",
		);
	});

	it("reads an SES error as one line naming the exception", () => {
		expect(
			getSesErrorMessage(
				400,
				"MessageRejected:http://internal.amazon.com/coral/com.amazonaws.sesv2/",
				'{"message":"Email address is not verified."}',
			),
		).toBe("Amazon SES MessageRejected: Email address is not verified.");
		expect(getSesErrorMessage(403, null, "")).toBe(
			"Amazon SES HTTP 403: request failed",
		);
	});
});

describe("recipient classes", () => {
	it("keeps To, Cc and Bcc in their own lists", () => {
		const request = buildSesSendEmailRequest({
			from: "me@dharun.dev",
			to: ["a@example.com"],
			cc: ["b@example.com"],
			bcc: ["hidden@example.com"],
			subject: "Hello",
			text: "Hello",
		});
		expect(request.Destination.ToAddresses).toEqual(["a@example.com"]);
		expect(request.Destination.CcAddresses).toEqual(["b@example.com"]);
		expect(request.Destination.BccAddresses).toEqual(["hidden@example.com"]);
	});

	it("omits the empty lists", () => {
		const request = buildSesSendEmailRequest({
			from: "me@dharun.dev",
			to: "a@example.com",
			subject: "Hello",
			text: "Hello",
		});
		expect(request.Destination.CcAddresses).toBeUndefined();
		expect(request.Destination.BccAddresses).toBeUndefined();
	});
});
