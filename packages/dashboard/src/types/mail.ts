/** Shapes returned by the mail API. */

export interface Thread {
	threadId: string;
	id: string;
	folderId: string;
	subject: string;
	sender: string;
	senderName: string | null;
	recipient: string;
	cc: string | null;
	date: string;
	preview: string;
	unread: boolean;
	unreadCount: number;
	starred: boolean;
	pinned: boolean;
	hasAttachments: boolean;
	messageCount: number;
	labels: string[];
	category: string | null;
	snoozedUntil: number | null;
	scheduledAt: number | null;
	deliveryState: string | null;
	deliveryDetail: string | null;
	listUnsubscribe: string | null;
	spamReason: string | null;
	summary: string | null;
	participants: string[];
}

export interface Attachment {
	id: string;
	email_id: string;
	filename: string;
	mimetype: string;
	size: number;
	content_id?: string | null;
	disposition?: string | null;
}

export interface Message {
	id: string;
	folder_id: string;
	subject: string;
	sender: string;
	sender_name: string | null;
	recipient: string;
	cc: string | null;
	bcc: string | null;
	date: string;
	body: string;
	preview: string;
	read: boolean;
	starred: boolean;
	pinned: boolean;
	labels: string[];
	attachments: Attachment[];
	in_reply_to: string | null;
	email_references: string | null;
	thread_id: string | null;
	message_id: string | null;
	delivery_state: string | null;
	delivery_detail: string | null;
	delivery_at: string | null;
	list_unsubscribe: string | null;
	spam_reason: string | null;
	scheduled_at: number | null;
	summary: string | null;
}

export interface ThreadDetail {
	threadId: string;
	subject: string;
	messages: Message[];
}

export interface Label {
	id: string;
	name: string;
	color: string;
	position: number;
}

export interface FolderCount {
	id: string;
	name: string;
	isDeletable: boolean;
	total: number;
	unread: number;
}

export interface Counts {
	folders: FolderCount[];
	categories: Array<{ id: string; total: number; unread: number }>;
	labels: Array<{ id: string; total: number; unread: number }>;
}

export interface MailStats {
	messages: number;
	messageBytes: number;
	attachmentCount: number;
	attachmentBytes: number;
	oldestMessage: string | null;
	ai: { date: string; used: number; limit: number; available: boolean };
}

export interface Identity {
	mode: "access" | "session";
	email: string | null;
	isAdmin: boolean;
	domain: string | null;
	addressManagement: boolean;
	ai: boolean;
}

export interface OutgoingAttachment {
	filename: string;
	type: string;
	content: string;
	disposition?: "attachment" | "inline";
	contentId?: string;
	size: number;
}

export interface Draft {
	id: string;
	from: string;
	to: string[];
	cc: string[];
	bcc: string[];
	subject: string;
	html: string;
	attachments: OutgoingAttachment[];
	inReplyTo: string | null;
	references: string[] | null;
	threadId: string | null;
	remindAt: number | null;
	/** Set while the window is an inline reply inside a thread. */
	inline: boolean;
	showCc: boolean;
	savedAt: number | null;
}
