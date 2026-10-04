const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// These endpoints handle authentication themselves.  A 401 from them is a
// legitimate credential failure, not an expired session, so we must not try
// to refresh the token, clear the session, or redirect to /login.
const AUTH_PATHS = new Set([
  "/api/auth/login/",
  "/api/auth/register/",
  "/api/auth/refresh/",
  "/api/auth/password/forgot/",
  "/api/auth/password/reset/",
]);

// Paths where a session-expired redirect would cause a reload loop.
const AUTH_PAGE_PATHS = new Set([
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

type ApiPage<T> = {
  count?: number;
  next: string | null;
  results: T[];
};

const MAX_API_PAGES = 50;

export async function fetchAllPages<T>(
  path: string,
  onPage?: (page: Pick<ApiPage<T>, "count">) => void,
): Promise<T[]> {
  const results: T[] = [];
  let nextPath: string | null = path;
  let pagesFetched = 0;

  while (nextPath && pagesFetched < MAX_API_PAGES) {
    const page: ApiPage<T> = await api<ApiPage<T>>(nextPath);
    onPage?.(page);
    results.push(...page.results);
    pagesFetched += 1;

    if (!page.next) {
      nextPath = null;
      continue;
    }

    const url = new URL(page.next, API);
    nextPath = `${url.pathname}${url.search}`;
  }

  if (nextPath) {
    console.warn(
      `fetchAllPages: stopped after ${MAX_API_PAGES} pages, results are truncated.`,
    );
  }

  return results;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiFieldErrors(error: unknown): Record<string, string[]> {
  return error instanceof ApiError ? (error.fields ?? {}) : {};
}

export function apiFormErrorMessage(
  error: unknown,
  handledFields: string[],
): string {
  const fields = apiFieldErrors(error);
  const globalError = Object.entries(fields).find(
    ([field]) => !handledFields.includes(field),
  )?.[1]?.[0];
  if (globalError) return globalError;
  if (Object.keys(fields).length > 0) return "";
  return errorMessage(error);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

export function setSession(access: string, refresh: string) {
  localStorage.setItem("access", access);
  localStorage.setItem("refresh", refresh);
  document.cookie = "session=1; path=/; max-age=604800; samesite=lax";
  window.dispatchEvent(new Event("tasklane:session"));
}
export function clearSession() {
  localStorage.removeItem("access");
  localStorage.removeItem("refresh");
  localStorage.removeItem("org");
  document.cookie = "session=; path=/; max-age=0";
  window.dispatchEvent(new Event("tasklane:session"));
}
export function setOrganization(id: string) {
  localStorage.setItem("org", id);
  window.dispatchEvent(new Event("tasklane:organization"));
}

async function doRefresh(): Promise<boolean> {
  const r = localStorage.getItem("refresh");
  if (!r) return false;
  const res = await fetch(`${API}/api/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: r }),
  });
  if (!res.ok) return false;
  const d = await res.json();
  setSession(d.access, d.refresh ?? r);
  return true;
}

// Single in-flight refresh: concurrent callers share the same Promise so the
// backend rotation endpoint is called exactly once per expiry cycle.
let refreshing: Promise<boolean> | null = null;

function refresh(): Promise<boolean> {
  if (refreshing === null) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

export async function refreshSession(): Promise<boolean> {
  const refreshed = await refresh();
  if (!refreshed) clearSession();
  return refreshed;
}

export async function api<T = any>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
  retry = true,
): Promise<T> {
  const isAuthPath = AUTH_PATHS.has(path);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Auth endpoints must not receive stale credentials — they authenticate
  // using the request body alone.
  if (!isAuthPath) {
    const token = localStorage.getItem("access");
    const org = localStorage.getItem("org");
    if (token) headers.Authorization = `Bearer ${token}`;
    if (org) headers["X-Organization-ID"] = org;
  }

  const token = isAuthPath ? undefined : localStorage.getItem("access");

  const res = await fetch(`${API}${path}`, {
    ...init,
    headers,
    body: init.json ? JSON.stringify(init.json) : init.body,
  });

  // ── Auth endpoints: 401 means bad credentials, not an expired session ──
  if (res.status === 401 && isAuthPath) {
    const data: unknown = await res.json().catch(() => ({}));
    const error =
      data && typeof data === "object" && "error" in data
        ? (
            data as {
              error?: {
                code?: string;
                message?: string;
                fields?: Record<string, string[]>;
              };
            }
          ).error
        : undefined;
    throw new ApiError(
      error?.code ?? "ERROR",
      error?.message ?? "Request failed",
      res.status,
      error?.fields,
    );
  }

  // ── Protected endpoints: try the shared refresh once ──
  if (res.status === 401 && retry) {
    const current = localStorage.getItem("access");
    if (current !== null && current !== token) {
      // Another concurrent request already refreshed; retry with the new token.
      return api<T>(path, init, false);
    }
    if (await refresh()) return api<T>(path, init, false);
  }

  if (res.status === 401) {
    clearSession();
    // Avoid a reload loop: if we're already on an auth page just throw.
    if (!AUTH_PAGE_PATHS.has(window.location.pathname)) {
      window.location.href = "/login";
    }
    const data: unknown = await res.json().catch(() => ({}));
    const error =
      data && typeof data === "object" && "error" in data
        ? (
            data as {
              error?: {
                code?: string;
                message?: string;
                fields?: Record<string, string[]>;
              };
            }
          ).error
        : undefined;
    throw new ApiError(
      error?.code ?? "ERROR",
      error?.message ?? "Request failed",
      res.status,
      error?.fields,
    );
  }

  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error =
      data && typeof data === "object" && "error" in data
        ? (
            data as {
              error?: {
                code?: string;
                message?: string;
                fields?: Record<string, string[]>;
              };
            }
          ).error
        : undefined;
    throw new ApiError(
      error?.code ?? "ERROR",
      error?.message ?? "Request failed",
      res.status,
      error?.fields,
    );
  }
  return data as T;
}

export const STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export type Status = (typeof STATUSES)[number];
export type Task = {
  id: number;
  project: number;
  organization: number;
  title: string;
  description: string;
  status: Status;
  priority: string;
  assigned_to: number | null;
  assigned_to_name: string | null;
  created_by: number;
  created_by_name: string;
  due_date: string | null;
  created_at?: string;
  updated_at?: string;
  comment_count?: number;
};
export type Org = {
  id: number;
  name: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
};
export type Project = {
  id: number;
  organization: number;
  name: string;
  description: string;
  status: "ACTIVE" | "ARCHIVED";
  created_by: number;
};
export type OrgMember = {
  id: number;
  user_id: number;
  email: string;
  name: string;
  role: Org["role"];
};
export const canWrite = (r?: string) =>
  r === "OWNER" || r === "ADMIN" || r === "MEMBER";
export const canManage = (r?: string) => r === "OWNER" || r === "ADMIN";
