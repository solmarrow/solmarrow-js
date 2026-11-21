"use strict";
// SolMarrow JavaScript SDK. No dependencies: uses the global fetch of Node 18+, Deno and Bun.

const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://app.solmarrow.com/api/v1";
const VERSION = "1.0.0";

class SolMarrowError extends Error {
  /**
   * @param {string} message
   * @param {number} status HTTP status (0 when the request never reached SolMarrow)
   * @param {unknown} [body] parsed response body
   */
  constructor(message, status, body) {
    super(message);
    this.name = "SolMarrowError";
    this.status = status;
    this.body = body;
  }
}

const seg = (id, name) => {
  const v = String(id ?? "").trim();
  if (!v) throw new TypeError(`${name} is required`);
  return encodeURIComponent(v);
};

function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    q.set(k, v instanceof Date ? v.toISOString() : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

const toIso = (v) => (v instanceof Date ? v.toISOString() : v);

function friendly(status, body) {
  const msg = body && typeof body === "object" && body.error && typeof body.error.message === "string" ? body.error.message : null;
  if (msg) return msg;
  if (status === 401) return "SolMarrow did not accept the API key or access token.";
  if (status === 429) return "Too many requests. Wait a minute and try again.";
  return `SolMarrow answered ${status}.`;
}

class SolMarrow {
  /**
   * @param {{ apiKey?: string, accessToken?: string, baseUrl?: string, fetch?: typeof fetch, timeoutMs?: number, userAgent?: string }} [options]
   */
  constructor(options = {}) {
    const env = typeof process !== "undefined" && process.env ? process.env : {};
    const token = String(options.apiKey || options.accessToken || env.SOLMARROW_API_KEY || "").trim();
    if (!token) throw new TypeError("Pass apiKey (smk_...) or set SOLMARROW_API_KEY. Create a key in SolMarrow: Settings > Apps and AI agents > API keys.");
    const f = options.fetch || (typeof fetch === "function" ? fetch : null);
    if (!f) throw new TypeError("No fetch found. Use Node 18 or newer, or pass options.fetch.");
    Object.defineProperty(this, "_token", { value: token, enumerable: false });
    this._fetch = f;
    this.baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.userAgent = options.userAgent || `solmarrow-js/${VERSION}`;
  }

  /** Low-level call: any /api/v1 path. Returns the parsed JSON (or null for an empty body). */
  async request(method, path, { body, headers } = {}) {
    const h = { Accept: "application/json", Authorization: `Bearer ${this._token}`, ...headers };
    if (typeof process !== "undefined" && process.versions && process.versions.node) h["User-Agent"] = this.userAgent;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller && this.timeoutMs ? setTimeout(() => controller.abort(), this.timeoutMs) : null;
    let res;
    try {
      res = await this._fetch(`${this.baseUrl}${path}`, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
      });
    } catch (e) {
      const aborted = e && (e.name === "AbortError" || e.name === "TimeoutError");
      throw new SolMarrowError(aborted ? `SolMarrow did not answer within ${this.timeoutMs} ms.` : `Could not reach SolMarrow: ${e && e.message ? e.message : e}`, 0);
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!res.ok) throw new SolMarrowError(friendly(res.status, json), res.status, json);
    return json;
  }

  /** The person and app behind the key or token. */
  me() {
    return this.request("GET", "/me");
  }

  /** Workspaces (an API key belongs to exactly one). */
  async listWorkspaces() {
    const r = await this.request("GET", "/workspaces");
    return (r && r.workspaces) || [];
  }

  /** Connected social accounts in a workspace, with each network's posting rules. */
  async listAccounts(workspaceId) {
    const r = await this.request("GET", `/workspaces/${seg(workspaceId, "workspaceId")}/accounts`);
    return (r && r.accounts) || [];
  }

  /** Posts, newest first. Filters: status, from, to, limit (1-50). */
  listPosts(workspaceId, filters = {}) {
    return this.request("GET", `/workspaces/${seg(workspaceId, "workspaceId")}/posts${query(filters)}`);
  }

  /** One post with its accounts, status and results. */
  getPost(postId) {
    return this.request("GET", `/posts/${seg(postId, "postId")}`);
  }

  /**
   * Save a draft, schedule a post (scheduleAt at least 5 minutes ahead) or publish now.
   * With no scheduleAt and no publishNow the post is saved as a draft.
   */
  createPost(workspaceId, post) {
    if (!post || typeof post.text !== "string") throw new TypeError("post.text is required");
    const body = {
      text: post.text,
      account_ids: post.accountIds || [],
      media_ids: post.mediaIds || [],
    };
    if (post.scheduleAt !== undefined) body.schedule_at = toIso(post.scheduleAt);
    if (post.publishNow !== undefined) body.publish_now = post.publishNow;
    if (post.draft !== undefined) body.draft = post.draft;
    if (post.perAccountText) body.per_account_text = post.perAccountText;
    if (post.perAccountOptions) body.per_account_options = post.perAccountOptions;
    const headers = post.idempotencyKey ? { "Idempotency-Key": String(post.idempotencyKey).slice(0, 200) } : undefined;
    return this.request("POST", `/workspaces/${seg(workspaceId, "workspaceId")}/posts`, { body, headers });
  }

  /** Shortcut: save a draft that shows in the SolMarrow calendar. */
  createDraft(workspaceId, text, extra = {}) {
    return this.createPost(workspaceId, { ...extra, text, draft: true });
  }

  /** Delete a draft, scheduled or failed post. */
  deletePost(postId) {
    return this.request("DELETE", `/posts/${seg(postId, "postId")}`);
  }

  /** Recent files in the media library. */
  listMedia(workspaceId) {
    return this.request("GET", `/workspaces/${seg(workspaceId, "workspaceId")}/media`);
  }

  /** Copy an image or video from a public https link into the media library. */
  uploadMediaFromUrl(workspaceId, url, fileName) {
    const body = { url: String(url) };
    if (fileName) body.file_name = fileName;
    return this.request("POST", `/workspaces/${seg(workspaceId, "workspaceId")}/media/from-url`, { body });
  }

  /**
   * Upload file bytes (up to 90 MB) into the media library in one call.
   * @param {string} workspaceId
   * @param {Uint8Array|ArrayBuffer|Blob} data
   * @param {{ fileName: string, mimeType: string }} file
   */
  async uploadMedia(workspaceId, data, { fileName, mimeType }) {
    if (!fileName || !mimeType) throw new TypeError("fileName and mimeType are required");
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const size = typeof Blob !== "undefined" && bytes instanceof Blob ? bytes.size : bytes && bytes.byteLength;
    if (!size) throw new TypeError("data is empty");
    const ws = seg(workspaceId, "workspaceId");
    const start = await this.request("POST", `/workspaces/${ws}/media/uploads`, { body: { file_name: fileName, mime_type: mimeType, size } });
    let put;
    try {
      put = await this._fetch(start.upload_url, { method: start.method || "PUT", headers: start.headers || { "Content-Type": mimeType }, body: bytes });
    } catch (e) {
      throw new SolMarrowError(`Upload failed: ${e && e.message ? e.message : e}`, 0);
    }
    if (!put.ok) throw new SolMarrowError(`Upload failed (${put.status}).`, put.status);
    return this.request("POST", `/workspaces/${ws}/media/uploads/complete`, { body: { upload_id: start.upload_id, file_name: fileName, mime_type: mimeType } });
  }

  /** Likes, comments, shares and views of published posts. Filters: from, to, postId. */
  getAnalytics(workspaceId, filters = {}) {
    const { postId, ...rest } = filters;
    return this.request("GET", `/workspaces/${seg(workspaceId, "workspaceId")}/analytics${query({ ...rest, post_id: postId })}`);
  }

  /** This key's webhooks in a workspace. */
  listWebhooks(workspaceId) {
    return this.request("GET", `/workspaces/${seg(workspaceId, "workspaceId")}/webhooks`);
  }

  /** Subscribe to post.scheduled, post.published or post.failed. The secret is returned once: store it. */
  createWebhook(workspaceId, url, events) {
    return this.request("POST", `/workspaces/${seg(workspaceId, "workspaceId")}/webhooks`, { body: { url, events } });
  }

  deleteWebhook(webhookId) {
    return this.request("DELETE", `/webhooks/${seg(webhookId, "webhookId")}`);
  }
}

/**
 * Checks a webhook delivery. Pass the raw request body (string or Buffer), the SolMarrow-Signature header
 * and the webhook secret. Returns the parsed event, or throws SolMarrowError(400) when the signature is wrong
 * or older than toleranceSeconds (default 300).
 */
function verifyWebhook(rawBody, signatureHeader, secret, { toleranceSeconds = 300, now = Date.now() } = {}) {
  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  const parts = Object.fromEntries(
    String(signatureHeader || "")
      .split(",")
      .map((p) => p.trim().split("="))
      .filter((p) => p.length === 2)
  );
  const t = Number(parts.t);
  if (!secret || !Number.isFinite(t) || !/^[0-9a-f]{64}$/.test(parts.v1 || "")) throw new SolMarrowError("Missing or malformed SolMarrow-Signature.", 400);
  if (toleranceSeconds && Math.abs(Math.floor(now / 1000) - t) > toleranceSeconds) throw new SolMarrowError("Webhook signature is too old.", 400);
  const expected = crypto.createHmac("sha256", String(secret)).update(`${t}.${body}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new SolMarrowError("Webhook signature does not match.", 400);
  return JSON.parse(body);
}

module.exports = SolMarrow;
module.exports.SolMarrow = SolMarrow;
module.exports.SolMarrowError = SolMarrowError;
module.exports.verifyWebhook = verifyWebhook;
module.exports.DEFAULT_BASE_URL = DEFAULT_BASE_URL;
module.exports.VERSION = VERSION;
module.exports.default = SolMarrow;
