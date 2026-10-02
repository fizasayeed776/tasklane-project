const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
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

async function refresh(): Promise<boolean> {
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
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = localStorage.getItem("access"),
    org = localStorage.getItem("org");
  if (token) headers.Authorization = `Bearer ${token}`;
  if (org) headers["X-Organization-ID"] = org;
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers,
    body: init.json ? JSON.stringify(init.json) : init.body,
  });
  if (res.status === 401 && retry && (await refresh()))
    return api<T>(path, init, false);
  if (res.status === 401) {
    clearSession();
    window.location.href = "/login";
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new ApiError(
      data?.error?.code ?? "ERROR",
      data?.error?.message ?? "Request failed",
      res.status,
    );
  return data;
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
