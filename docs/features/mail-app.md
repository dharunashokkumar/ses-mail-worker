# The mail app

A guide to the dashboard: what each part of the screen does, and where the
less obvious features live.

## Layout

Three panes: the sidebar, the conversation list and the reading pane.

- **Sidebar** — the address you are reading, a Compose button, folders,
  automatic categories, your labels, saved searches, and storage at the bottom.
  Click the address at the top to switch to another address on your domain.
- **List** — one card per conversation. Unread mail carries a blue dot and a
  heavier subject; a number after the sender says how many messages the
  conversation holds.
- **Reading pane** — the conversation, newest message open and the rest
  collapsed. Click any header to expand it.

On a phone the three panes become one: the list fills the screen, tapping a
conversation opens it, and the sidebar slides in from the left.

### Reading pane position

Settings → Appearance → Reading pane: **right**, **bottom** or **off**. With it
off, opening a conversation replaces the list, the way Mail's single-pane view
works.

### Density

Settings → Appearance → Density: **compact**, **cozy** or **relaxed**. Compact
drops the preview line and the label chips so more mail fits on screen.

## Conversations

Replies are grouped by the Message-IDs in their `References` and `In-Reply-To`
headers, so a conversation stays together across mail clients. Turn grouping
off in Settings → Reading and every message gets its own row.

## Working through mail

| Action | Where |
|---|---|
| Archive, snooze, label, flag, mark unread, delete | The toolbar above an open conversation |
| Flag from the list | The star at the right of a row |
| Bulk actions | Select rows, then use the bar above the list |
| Swipe actions | Swipe a row on a touch screen; configure both directions in Settings → Reading |

**Snooze** moves a conversation out of the way and brings it back at the time
you choose — later today, tomorrow, the weekend, next week. It returns to the
folder it came from, marked unread. A Durable Object alarm does this, so it
happens whether or not the app is open.

**Labels** are colours you apply yourself; a conversation can carry several.
Create them in Settings → Labels or from the Label menu in a conversation.

**Categories** are worked out automatically as mail arrives: *Newsletters*
(mail with a `List-Id` or bulk precedence), *Notifications* (no-reply senders
and automated mail) and *Receipts* (invoices, payments, orders).

## Search

The search box takes plain words and operators, and they can be mixed:

```
from:priya has:attachment is:unread before:2026-03-01 cutover
```

| Operator | Matches |
|---|---|
| `from:`, `to:`, `cc:` | An address or name |
| `subject:` | Words in the subject |
| `label:`, `category:` | A label or an automatic category |
| `in:`, `folder:` | A folder |
| `has:attachment` | Mail with files |
| `is:unread`, `is:read`, `is:flagged`, `is:pinned` | State (`-is:flagged` negates) |
| `before:`, `after:`, `on:` | Dates as `YYYY-MM-DD` |
| `"exact words"` | A phrase |

Words are matched against a SQLite FTS5 index kept inside the mailbox, so
results come back as you type. Press **Save** beside the search box to keep a
search in the sidebar.

## Writing

Compose opens a floating window; replies open inline under the conversation;
on a phone both fill the screen.

- **Recipients** are chips. Type a name or address and press Enter, Tab or
  comma; suggestions come from the contacts collected automatically from your
  mail. Cc and Bcc are behind the Cc/Bcc button.
- **Formatting** is rich text with Markdown shortcuts: `**bold**`, `*italic*`,
  `- ` for a list, `> ` for a quote, `# ` for a heading.
- **Attachments** can be dropped on the window, pasted, or picked with the
  paperclip.
- **Drafts** save themselves a couple of seconds after you stop typing, and
  appear in the Drafts folder.
- **Undo send** holds every message for a few seconds after you press Send —
  ten by default, changeable in Settings → Reading. Nothing leaves until the
  toast disappears, so Undo really does undo.
- **Send later** is the arrow beside Send: tonight, tomorrow morning, Monday.
  Scheduled mail sits in the Scheduled folder until a Durable Object alarm
  sends it.
- **Remind me** flags the message if nobody replies within two days or a week.
- **Templates** saved in the mailbox appear under the document icon.

## Delivery status

Mail sent through Amazon SES reports back: *Accepted*, *Delivered*, *Opened*,
*Bounced* or *Marked as spam*, shown under the message in the Sent folder. This
needs the SNS webhook described in the README; without it, messages stay at
*Accepted*.

## Spam, blocking and unsubscribing

Inbound mail is scored on its `Authentication-Results`: DMARC, SPF and DKIM
failures, and senders you have blocked, land in Spam with the reason shown.
**Not spam** puts a conversation back in the Inbox. **Block sender** moves
their existing mail to Spam and holds anything new. Newsletters that offer
`List-Unsubscribe` get an **Unsubscribe** button, which sends the unsubscribe
mail for you or opens the page.

## Rules

Settings → Filters. A rule matches on sender, recipient, subject, body or
mailing list and can move mail to a folder and add labels. Rules run inside the
Durable Object as mail arrives, before it reaches the Inbox.

## AI

With the Workers AI binding enabled, the toolbar above a conversation offers
**Summarise**: three bullets and three short reply suggestions. The composer
offers **Rewrite**. Both run on the Workers AI free tier — 10,000 neurons a day
— and the app stops calling the model before the budget runs out rather than
failing; the remaining budget is in Settings → Storage.

## Offline and installing

The dashboard is a PWA: install it from the browser's address bar and it opens
in its own window. A service worker caches the app and the mail you have already
loaded, so the inbox opens and reads offline. Mail written while offline waits
in an outbox and is sent when the connection comes back.

## Keyboard

`Ctrl`/`⌘` + `K` opens the command palette: compose, go to a folder or label,
archive, snooze, summarise, change the reading pane, theme or density, switch
address, or search. There are no single-key shortcuts, so typing in a message
never triggers an action.
