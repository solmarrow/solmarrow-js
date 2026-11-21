# SolMarrow JavaScript SDK

Official JavaScript client for [SolMarrow](https://solmarrow.com), the free social media scheduler with AI agents.
Save drafts, schedule or publish posts to 20+ networks, upload media, read analytics and verify webhooks.

- No dependencies. Works in Node 18+, Bun and Deno.
- CommonJS and ESM, with TypeScript types.

## Install

```bash
npm install solmarrow
```

## Get an API key

In SolMarrow go to **Settings → API keys** and create a key (`smk_...`).
Each key belongs to one workspace. Keep it in an environment variable, never in your code:

```bash
export SOLMARROW_API_KEY=smk_...
```

## Quick start

```js
import SolMarrow from "solmarrow"; // or: const SolMarrow = require("solmarrow")

const sm = new SolMarrow(); // reads SOLMARROW_API_KEY

const [workspace] = await sm.listWorkspaces();
const accounts = await sm.listAccounts(workspace.id);

// Save a draft (shows in your SolMarrow calendar)
await sm.createDraft(workspace.id, "Hello from the SolMarrow SDK!");

// Schedule a post (at least 5 minutes ahead)
await sm.createPost(workspace.id, {
  text: "Our new feature is live 🚀",
  accountIds: accounts.filter((a) => a.status === "active").map((a) => a.id),
  scheduleAt: new Date(Date.now() + 60 * 60 * 1000),
  idempotencyKey: "launch-post-1", // safe retries
});
```

## Media

```js
// From a public https link (JPG, PNG, WebP, GIF, MP4, MOV, WebM)
const { media_id } = await sm.uploadMediaFromUrl(workspace.id, "https://example.com/photo.jpg");

// Or upload bytes (up to 90 MB)
import { readFile } from "node:fs/promises";
const file = await sm.uploadMedia(workspace.id, await readFile("photo.png"), { fileName: "photo.png", mimeType: "image/png" });

await sm.createDraft(workspace.id, "With a photo", { mediaIds: [media_id] });
```

## All methods

| Method | What it does |
| --- | --- |
| `me()` | The person and app behind the key |
| `listWorkspaces()` | Workspaces with their time zones |
| `listAccounts(workspaceId)` | Connected accounts and each network's posting rules |
| `listPosts(workspaceId, { status, from, to, limit })` | Posts, newest first |
| `getPost(postId)` | One post with status and results |
| `createPost(workspaceId, { text, accountIds, mediaIds, scheduleAt, publishNow, draft, perAccountText, perAccountOptions, idempotencyKey })` | Draft, schedule or publish |
| `createDraft(workspaceId, text, extra?)` | Shortcut for a draft |
| `deletePost(postId)` | Delete a draft, scheduled or failed post |
| `listMedia(workspaceId)` | Recent media library files |
| `uploadMediaFromUrl(workspaceId, url, fileName?)` | Copy a file from a public link |
| `uploadMedia(workspaceId, data, { fileName, mimeType })` | Upload bytes |
| `getAnalytics(workspaceId, { from, to, postId })` | Likes, comments, shares, views |
| `listWebhooks` / `createWebhook(workspaceId, url, events)` / `deleteWebhook(id)` | Post event webhooks |
| `request(method, path, { body, headers })` | Any other `/api/v1` call |

## Webhooks

Subscribe to `post.scheduled`, `post.published` or `post.failed`. The secret is returned once.
Check every delivery with the raw body and the `SolMarrow-Signature` header:

```js
import { verifyWebhook } from "solmarrow";

app.post("/solmarrow", express.raw({ type: "application/json" }), (req, res) => {
  try {
    const event = verifyWebhook(req.body, req.get("SolMarrow-Signature"), process.env.SOLMARROW_WEBHOOK_SECRET);
    console.log(event);
    res.sendStatus(200);
  } catch {
    res.sendStatus(400);
  }
});
```

## Errors

Failed calls throw `SolMarrowError` with `status` (HTTP status, `0` if SolMarrow could not be reached),
a readable `message` and the response `body`.

```js
import { SolMarrowError } from "solmarrow";
try {
  await sm.createDraft(workspace.id, "...");
} catch (e) {
  if (e instanceof SolMarrowError && e.status === 429) { /* wait and retry */ }
}
```

The API allows 120 requests a minute per key.

## Options

```js
new SolMarrow({
  apiKey: "smk_...",       // or accessToken for "Sign in with SolMarrow" apps
  timeoutMs: 30000,
  baseUrl: "https://app.solmarrow.com/api/v1",
  fetch: customFetch,
});
```

## Links

- API reference: https://solmarrow.com/developers
- MCP server for AI agents: https://solmarrow.com/ai-agents
- Support: support@solmarrow.com

MIT License
