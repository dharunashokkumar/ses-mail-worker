# Feature documentation

Guides to the mail app and the accounts behind it.

## The app

### 📬 [The mail app](./mail-app.md)
The dashboard end to end.
- Layout, reading pane, density and themes
- Conversations, labels, categories, snooze and rules
- Search operators and saved searches
- Composing: chips, attachments, drafts, undo send, send later
- Delivery status, spam and unsubscribe
- AI summaries, offline use and the command palette

### ↩️ [Reply and forward](./reply-forward.md)
How replies thread, and what the API sends.

## Accounts

Only relevant when the app uses its own login. Behind Cloudflare Access
(`AUTH_MODE=access`), Access authenticates every request and these screens are
not used.

### 🔐 [Authentication](./authentication.md)
Registering, signing in, and how sessions work.

### 👥 [Admin panel](./admin-panel.md)
Creating users and granting access to mailboxes.

### 🔑 [Account recovery](./account-recovery.md)
Resetting a forgotten password by email.

## Setup

Deployment, Amazon SES, Email Routing, Cloudflare Access and the optional
secrets are covered in the [README](../../README.md).
