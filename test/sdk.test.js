"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const SolMarrow = require("..");
const { SolMarrowError, verifyWebhook } = SolMarrow;

const KEY = "smk_test_abcdefghijklmnopqrstuvwxyz";
const WS = "11111111-1111-4111-8111-111111111111";

function fakeFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, ...init, json: init.body && typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const { status = 200, body = {} } = (await handler(url, init)) || {};
    const text = body === null ? "" : typeof body === "string" ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  f.calls = calls;
  return f;
}

test("needs a key", () => {
  const saved = process.env.SOLMARROW_API_KEY;
  delete process.env.SOLMARROW_API_KEY;
  assert.throws(() => new SolMarrow(), /apiKey/);
  process.env.SOLMARROW_API_KEY = KEY;
  assert.doesNotThrow(() => new SolMarrow({ fetch: fakeFetch(() => {}) }));
  if (saved === undefined) delete process.env.SOLMARROW_API_KEY;
  else process.env.SOLMARROW_API_KEY = saved;
});

test("key is not enumerable (not printed by console.log / JSON)", () => {
  const sm = new SolMarrow({ apiKey: KEY, fetch: fakeFetch(() => {}) });
  assert.ok(!JSON.stringify(sm).includes(KEY));
  assert.ok(!Object.keys(sm).some((k) => String(sm[k]).includes(KEY)));
});

test("listWorkspaces sends bearer and returns the list", async () => {
  const f = fakeFetch(() => ({ body: { workspaces: [{ id: WS, name: "Main" }] } }));
  const sm = new SolMarrow({ apiKey: KEY, fetch: f });
  assert.deepEqual(await sm.listWorkspaces(), [{ id: WS, name: "Main" }]);
  assert.equal(f.calls[0].url, "https://app.solmarrow.com/api/v1/workspaces");
  assert.equal(f.calls[0].method, "GET");
  assert.equal(f.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(f.calls[0].body, undefined);
});

test("createPost maps fields, Date -> ISO, idempotency header", async () => {
  const f = fakeFetch(() => ({ status: 201, body: { post_id: "p1" } }));
  const sm = new SolMarrow({ apiKey: KEY, fetch: f, baseUrl: "https://x.test/api/v1/" });
  const at = new Date("2030-01-02T03:04:05Z");
  const r = await sm.createPost(WS, { text: "Hi", accountIds: ["a1"], mediaIds: ["m1"], scheduleAt: at, idempotencyKey: "k1", perAccountText: { a1: "Hi a1" } });
  assert.equal(r.post_id, "p1");
  const c = f.calls[0];
  assert.equal(c.url, `https://x.test/api/v1/workspaces/${WS}/posts`);
  assert.equal(c.method, "POST");
  assert.equal(c.headers["Idempotency-Key"], "k1");
  assert.equal(c.headers["Content-Type"], "application/json");
  assert.deepEqual(c.json, { text: "Hi", account_ids: ["a1"], media_ids: ["m1"], schedule_at: "2030-01-02T03:04:05.000Z", per_account_text: { a1: "Hi a1" } });
});

test("createDraft sets draft true", async () => {
  const f = fakeFetch(() => ({ status: 201, body: { post_id: "p2" } }));
  await new SolMarrow({ apiKey: KEY, fetch: f }).createDraft(WS, "Draft text");
  assert.deepEqual(f.calls[0].json, { text: "Draft text", account_ids: [], media_ids: [], draft: true });
});

test("ids are url-encoded and required", async () => {
  const f = fakeFetch(() => ({ body: null }));
  const sm = new SolMarrow({ apiKey: KEY, fetch: f });
  await sm.deletePost("a/b?c");
  assert.equal(f.calls[0].url, "https://app.solmarrow.com/api/v1/posts/a%2Fb%3Fc");
  assert.equal(f.calls[0].method, "DELETE");
  assert.throws(() => sm.getPost(""), /postId is required/);
});

test("query filters skip empty values and map postId", async () => {
  const f = fakeFetch(() => ({ body: {} }));
  const sm = new SolMarrow({ apiKey: KEY, fetch: f });
  await sm.listPosts(WS, { status: "draft", limit: 5, from: "" });
  await sm.getAnalytics(WS, { postId: "p9", to: new Date("2030-01-01T00:00:00Z") });
  assert.ok(f.calls[0].url.endsWith(`/workspaces/${WS}/posts?status=draft&limit=5`));
  assert.ok(f.calls[1].url.endsWith(`/analytics?to=2030-01-01T00%3A00%3A00.000Z&post_id=p9`));
});

test("API errors become SolMarrowError with the server message", async () => {
  const sm = new SolMarrow({ apiKey: KEY, fetch: fakeFetch(() => ({ status: 422, body: { error: { status: 422, message: "Text is too long for X." } } })) });
  await assert.rejects(sm.createDraft(WS, "x"), (e) => e instanceof SolMarrowError && e.status === 422 && e.message === "Text is too long for X.");
  const sm2 = new SolMarrow({ apiKey: KEY, fetch: fakeFetch(() => ({ status: 401, body: "" })) });
  await assert.rejects(sm2.me(), (e) => e.status === 401 && /API key/.test(e.message));
});

test("network failure and timeout", async () => {
  const down = new SolMarrow({ apiKey: KEY, fetch: async () => { throw new Error("ECONNREFUSED"); } });
  await assert.rejects(down.me(), (e) => e.status === 0 && /ECONNREFUSED/.test(e.message));
  const slow = new SolMarrow({
    apiKey: KEY,
    timeoutMs: 20,
    fetch: (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  });
  await assert.rejects(slow.me(), (e) => e.status === 0 && /20 ms/.test(e.message));
});

test("uploadMedia: start, PUT bytes without bearer, complete", async () => {
  const f = fakeFetch((url) => {
    if (url.endsWith("/media/uploads")) return { status: 201, body: { upload_id: `${WS}/u.png`, upload_url: "https://storage.test/put?sig=1", method: "PUT", headers: { "Content-Type": "image/png", "Content-Length": "3" } } };
    if (url.startsWith("https://storage.test/")) return { status: 200, body: null };
    return { status: 201, body: { media_id: "m1" } };
  });
  const r = await new SolMarrow({ apiKey: KEY, fetch: f }).uploadMedia(WS, new Uint8Array([1, 2, 3]), { fileName: "u.png", mimeType: "image/png" });
  assert.equal(r.media_id, "m1");
  assert.deepEqual(f.calls[0].json, { file_name: "u.png", mime_type: "image/png", size: 3 });
  assert.equal(f.calls[1].url, "https://storage.test/put?sig=1");
  assert.equal(f.calls[1].headers.Authorization, undefined);
  assert.deepEqual(f.calls[2].json, { upload_id: `${WS}/u.png`, file_name: "u.png", mime_type: "image/png" });
});

test("verifyWebhook accepts a good signature and rejects bad/old ones", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ event: "post.published", post_id: "p1" });
  const t = 1_800_000_000;
  const sig = `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  assert.deepEqual(verifyWebhook(body, sig, secret, { now: t * 1000 }), { event: "post.published", post_id: "p1" });
  assert.deepEqual(verifyWebhook(Buffer.from(body), sig, secret, { now: t * 1000 }).post_id, "p1");
  assert.throws(() => verifyWebhook(body + " ", sig, secret, { now: t * 1000 }), /does not match/);
  assert.throws(() => verifyWebhook(body, sig, "other", { now: t * 1000 }), /does not match/);
  assert.throws(() => verifyWebhook(body, sig, secret, { now: (t + 301) * 1000 }), /too old/);
  assert.throws(() => verifyWebhook(body, "nope", secret), /malformed/);
});

test("ESM entry exports the same API", async () => {
  const m = await import("../index.mjs");
  assert.equal(m.default, SolMarrow);
  assert.equal(m.SolMarrow, SolMarrow);
  assert.equal(m.verifyWebhook, verifyWebhook);
  assert.equal(m.SolMarrowError, SolMarrowError);
});
