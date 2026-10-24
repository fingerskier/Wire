# Wire

A custom Telegram GUI for a small crew. Every chat you care about (the group
and each of the boys) gets its own column, side by side, in a mono wire-log
style: no bubbles, one line per message, one color per person.

It's a static site (GitHub Pages). It talks straight from your browser to
Telegram over MTProto ([GramJS](https://github.com/gram-js/gramjs)). There is
no server in between.

## Use it

1. Open the site. It starts in **demo** mode with made-up chats, so you can
   try the deck before connecting anything.
2. Get your own Telegram app keys at <https://my.telegram.org/apps>
   (API development tools): an `api_id` and an `api_hash`.
3. Settings → `[mode]` → **telegram**, enter the keys, then sign in with
   your phone number, the login code, and your 2FA password if you have one.
4. **+ column** adds a chat. Reorder, resize or remove columns from the column
   header or from settings.

On a phone the deck shows one column at a time. Swipe sideways or use the tabs.

## Where your data lives

- **Settings** are saved in `localStorage` under `wire:settings:v1`. Export
  and import them as JSON from settings.
- **The Telegram session** is saved separately under `wire:session`. Anyone
  who can read this browser's storage can use your account, so only sign in
  on your own devices. Settings → `[connection]` → **wipe** removes it from
  the browser, and **sign out** also ends it on Telegram's side.
  Exports never include the session.
- The `api_hash` is sent only to Telegram.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

React + TypeScript + Vite. The UI only talks to a `ChatService`
(`src/service/types.ts`), with two implementations:

- `DemoService`: in-memory sample crew, replies on its own.
- `TelegramService`: GramJS user client. It is lazy-loaded, so the demo never
  downloads it.

## Deploy

`.github/workflows/pages.yml` builds and deploys on every push to `main`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

## Not yet

Sending photos or files, downloading media (shown as `[photo]` placeholders),
reactions, polls, voice, secret chats, more than one account.
