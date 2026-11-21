export interface SolMarrowOptions {
  /** API key (smk_...). Falls back to the SOLMARROW_API_KEY environment variable. */
  apiKey?: string;
  /** OAuth access token, for apps that use "Sign in with SolMarrow". */
  accessToken?: string;
  /** Default https://app.solmarrow.com/api/v1 */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Default 30000 */
  timeoutMs?: number;
  userAgent?: string;
}

export interface Workspace { id: string; name: string; timezone?: string; [key: string]: unknown }
export interface Account { id: string; name: string; handle?: string | null; network: string; network_name?: string; status: string; [key: string]: unknown }
export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partially_published" | "failed";

export interface CreatePostInput {
  text: string;
  accountIds?: string[];
  mediaIds?: string[];
  /** ISO 8601 with offset or a Date, at least 5 minutes ahead. */
  scheduleAt?: string | Date;
  publishNow?: boolean;
  draft?: boolean;
  perAccountText?: Record<string, string>;
  perAccountOptions?: Record<string, Record<string, string | boolean>>;
  /** Safe retries: the same key returns the first post instead of a second one. */
  idempotencyKey?: string;
}

export interface ListPostsFilters { status?: PostStatus; from?: string | Date; to?: string | Date; limit?: number }
export interface AnalyticsFilters { from?: string | Date; to?: string | Date; postId?: string }
export type WebhookEvent = "post.scheduled" | "post.published" | "post.failed";
export type Json = Record<string, any>;

export declare class SolMarrowError extends Error {
  /** HTTP status, 0 when the request never reached SolMarrow. */
  status: number;
  body?: unknown;
  constructor(message: string, status: number, body?: unknown);
}

export declare class SolMarrow {
  constructor(options?: SolMarrowOptions);
  readonly baseUrl: string;
  timeoutMs: number;
  request<T = Json>(method: "GET" | "POST" | "DELETE" | "PATCH" | "PUT", path: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<T>;
  me(): Promise<Json>;
  listWorkspaces(): Promise<Workspace[]>;
  listAccounts(workspaceId: string): Promise<Account[]>;
  listPosts(workspaceId: string, filters?: ListPostsFilters): Promise<Json>;
  getPost(postId: string): Promise<Json>;
  createPost(workspaceId: string, post: CreatePostInput): Promise<Json>;
  createDraft(workspaceId: string, text: string, extra?: Omit<CreatePostInput, "text" | "draft" | "scheduleAt" | "publishNow">): Promise<Json>;
  deletePost(postId: string): Promise<Json | null>;
  listMedia(workspaceId: string): Promise<Json>;
  uploadMediaFromUrl(workspaceId: string, url: string, fileName?: string): Promise<Json>;
  uploadMedia(workspaceId: string, data: Uint8Array | ArrayBuffer | Blob, file: { fileName: string; mimeType: string }): Promise<Json>;
  getAnalytics(workspaceId: string, filters?: AnalyticsFilters): Promise<Json>;
  listWebhooks(workspaceId: string): Promise<Json>;
  createWebhook(workspaceId: string, url: string, events: WebhookEvent[]): Promise<Json>;
  deleteWebhook(webhookId: string): Promise<Json | null>;
}

export declare function verifyWebhook(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
  options?: { toleranceSeconds?: number; now?: number }
): Json;

export declare const DEFAULT_BASE_URL: string;
export declare const VERSION: string;
export default SolMarrow;
