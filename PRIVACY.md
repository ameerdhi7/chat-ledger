# Chat Ledger — Privacy Policy

_Last updated: 6 November 2026_

Chat Ledger is an unofficial browser extension. It is not made by, affiliated with, or endorsed by WhatsApp or any bank or wallet.

## What it reads
When WhatsApp Web is open, the extension opens **only the chats you named** in its dashboard and reads the
transaction alerts in them. It does not read any other chat, contact, media, or the messages you send.

## What it keeps
From each alert it keeps only: date, time, provider tag, money in or out, amount, currency, merchant name and city,
and balance. The message text is not stored. It also keeps your settings (chat names, budget, lock PIN hash, passkey ID).

## Where it goes
Nowhere. Everything stays in your browser's local extension storage. There is no server, no account and no analytics,
and the extension can't reach any site except web.whatsapp.com. Its pages block all network connections
(`connect-src 'none'`). Data leaves your computer only when **you** export a CSV or download/copy a share card.

## Lock
An optional PIN (stored as a salted PBKDF2 hash) and passkey hide the dashboard from other people using your computer.
This hides the data. It does not encrypt it.

## Deleting your data
Settings → **Delete all data** erases everything, and so does uninstalling. Your WhatsApp messages are never changed.
