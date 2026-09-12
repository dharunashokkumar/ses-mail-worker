import type { Migration } from "workers-qb";

export const mailboxMigrations: Migration[] = [
	{
		name: "1_initial_setup",
		sql: `
            CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                is_deletable INTEGER NOT NULL DEFAULT 1
            );

            INSERT INTO folders (id, name, is_deletable) VALUES
                ('inbox', 'Inbox', 0),
                ('sent', 'Sent', 0),
                ('trash', 'Trash', 0),
                ('archive', 'Archive', 0),
                ('spam', 'Spam', 0);

            CREATE TABLE emails (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                subject TEXT,
                sender TEXT,
                recipient TEXT,
                date TEXT,
                read INTEGER DEFAULT 0,
                starred INTEGER DEFAULT 0,
                body TEXT,
                FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
            );

            CREATE TABLE contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                email TEXT NOT NULL UNIQUE
            );

            CREATE TABLE attachments (
                id TEXT PRIMARY KEY,
                email_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                mimetype TEXT NOT NULL,
                size INTEGER NOT NULL,
                content_id TEXT,
                disposition TEXT,
                FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
            );
        `,
	},
	{
		name: "2_add_email_threading",
		sql: `
            ALTER TABLE emails ADD COLUMN in_reply_to TEXT;
            ALTER TABLE emails ADD COLUMN email_references TEXT;
            ALTER TABLE emails ADD COLUMN thread_id TEXT;
            
            CREATE INDEX idx_emails_thread_id ON emails(thread_id);
            CREATE INDEX idx_emails_in_reply_to ON emails(in_reply_to);
        `,
	},
	{
		name: "3_mail_features",
		sql: `
            ALTER TABLE emails ADD COLUMN message_id TEXT;
            ALTER TABLE emails ADD COLUMN cc TEXT;
            ALTER TABLE emails ADD COLUMN bcc TEXT;
            ALTER TABLE emails ADD COLUMN preview TEXT;
            ALTER TABLE emails ADD COLUMN category TEXT;
            ALTER TABLE emails ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE emails ADD COLUMN snoozed_until INTEGER;
            ALTER TABLE emails ADD COLUMN scheduled_at INTEGER;
            ALTER TABLE emails ADD COLUMN remind_at INTEGER;
            ALTER TABLE emails ADD COLUMN has_attachments INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE emails ADD COLUMN list_unsubscribe TEXT;
            ALTER TABLE emails ADD COLUMN spam_reason TEXT;
            ALTER TABLE emails ADD COLUMN auth_results TEXT;
            ALTER TABLE emails ADD COLUMN delivery_state TEXT;
            ALTER TABLE emails ADD COLUMN delivery_detail TEXT;
            ALTER TABLE emails ADD COLUMN delivery_at TEXT;
            ALTER TABLE emails ADD COLUMN body_key TEXT;
            ALTER TABLE emails ADD COLUMN size INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE emails ADD COLUMN return_folder TEXT;
            ALTER TABLE emails ADD COLUMN summary TEXT;

            ALTER TABLE contacts ADD COLUMN last_seen INTEGER;
            ALTER TABLE contacts ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;

            INSERT OR IGNORE INTO folders (id, name, is_deletable) VALUES
                ('drafts', 'Drafts', 0),
                ('snoozed', 'Snoozed', 0),
                ('scheduled', 'Scheduled', 0);

            CREATE TABLE labels (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#2b74e8',
                position INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE email_labels (
                email_id TEXT NOT NULL,
                label_id TEXT NOT NULL,
                PRIMARY KEY (email_id, label_id)
            );

            CREATE TABLE rules (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                position INTEGER NOT NULL DEFAULT 0,
                match_all INTEGER NOT NULL DEFAULT 1,
                conditions TEXT NOT NULL,
                actions TEXT NOT NULL
            );

            CREATE TABLE blocked_senders (
                address TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE saved_searches (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                query TEXT NOT NULL,
                position INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE templates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                subject TEXT,
                body TEXT
            );

            CREATE TABLE settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE INDEX idx_emails_folder_date ON emails(folder_id, date DESC);
            CREATE INDEX idx_emails_snoozed ON emails(snoozed_until);
            CREATE INDEX idx_emails_scheduled ON emails(scheduled_at);
            CREATE INDEX idx_emails_message_id ON emails(message_id);
            CREATE INDEX idx_email_labels_label ON email_labels(label_id);
        `,
	},
	{
		name: "4_full_text_search",
		sql: `
            CREATE VIRTUAL TABLE emails_fts USING fts5(
                email_id UNINDEXED,
                subject,
                sender,
                recipient,
                body,
                tokenize='unicode61 remove_diacritics 2'
            );

            INSERT INTO emails_fts (email_id, subject, sender, recipient, body)
                SELECT id, COALESCE(subject, ''), COALESCE(sender, ''),
                       COALESCE(recipient, ''), COALESCE(body, '')
                FROM emails;
        `,
	},
	{
		name: "5_sender_display_name",
		sql: `
            ALTER TABLE emails ADD COLUMN sender_name TEXT;
        `,
	},
	{
		name: "6_attachment_keys_and_system_folders",
		sql: `
            ALTER TABLE attachments ADD COLUMN object_key TEXT;

            UPDATE emails SET folder_id = folder_id || '-user'
                WHERE folder_id IN (
                    SELECT id FROM folders
                    WHERE id IN ('drafts', 'snoozed', 'scheduled') AND is_deletable = 1
                );
            UPDATE folders SET id = id || '-user', name = name || ' (yours)'
                WHERE id IN ('drafts', 'snoozed', 'scheduled') AND is_deletable = 1;
            INSERT OR IGNORE INTO folders (id, name, is_deletable) VALUES
                ('drafts', 'Drafts', 0),
                ('snoozed', 'Snoozed', 0),
                ('scheduled', 'Scheduled', 0);
        `,
	},
];

export const authMigrations: Migration[] = [
	{
		name: "1_auth_setup",
		sql: `
            CREATE TABLE users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE user_mailboxes (
                user_id TEXT NOT NULL,
                mailbox_id TEXT NOT NULL,
                role TEXT NOT NULL,
                PRIMARY KEY (user_id, mailbox_id)
            );

            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX idx_sessions_user_id ON sessions(user_id);
            CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
            CREATE INDEX idx_user_mailboxes_user_id ON user_mailboxes(user_id);
            CREATE INDEX idx_user_mailboxes_mailbox_id ON user_mailboxes(mailbox_id);
        `,
	},
];
