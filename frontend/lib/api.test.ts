import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  api,
  clearSession,
  fetchAllPages,
  refreshSession,
} from "@/lib/api";

// The module uses NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
const REFRESH_URL = "http://localhost:8000/api/auth/refresh/";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("single-flight token refresh", () => {
  it("calls the refresh endpoint exactly once for concurrent 401s", async () => {
    localStorage.setItem("access", "old");
    localStorage.setItem("refresh", "r1");

    let refreshCallCount = 0;

    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);

        if (url === REFRESH_URL) {
          refreshCallCount += 1;
          // Simulate network latency so all three api() calls have time to
          // arrive before any one of them resolves the refresh.
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
          return new Response(
            JSON.stringify({ access: "new", refresh: "r2" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        // Data endpoints: succeed only with the refreshed token.
        const auth = (init?.headers as Record<string, string> | undefined)?.[
          "Authorization"
        ];
        if (auth === "Bearer new") {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // Expired token → 401 (triggers the refresh logic).
        return new Response(JSON.stringify({}), { status: 401 });
      },
    );

    const results = await Promise.all([
      api("/api/a/"),
      api("/api/b/"),
      api("/api/c/"),
    ]);

    expect(results).toHaveLength(3);
    results.forEach((r) => expect(r).toEqual({ ok: true }));
    expect(refreshCallCount).toBe(1);
    expect(localStorage.getItem("refresh")).toBe("r2");
  });

  it("clears the session when the refresh endpoint returns 401", async () => {
    localStorage.setItem("access", "old");
    localStorage.setItem("refresh", "bad-token");

    // Suppress the window.location redirect that clearSession triggers
    // (jsdom doesn't support navigation, so we just let it throw or ignore).
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : String(input);
        if (url === REFRESH_URL) {
          return new Response(JSON.stringify({}), { status: 401 });
        }
        return new Response(JSON.stringify({}), { status: 401 });
      },
    );

    // refreshSession() calls refresh() then clearSession() on failure.
    const refreshed = await refreshSession();
    expect(refreshed).toBe(false);
    expect(localStorage.getItem("access")).toBeNull();
    expect(localStorage.getItem("refresh")).toBeNull();
  });
});

describe("auth-endpoint 401 handling", () => {
  it("throws ApiError for a 401 from /api/auth/login/ without touching the session or redirecting", async () => {
    // Seed some unrelated localStorage data that must survive the 401.
    localStorage.setItem("org", "42");

    // Capture any writes to window.location.href.
    const hrefSpy = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      pathname: "/login",
      get href() {
        return window.location.href;
      },
      set href(v: string) {
        hrefSpy(v);
      },
    });

    const fetchCallUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        fetchCallUrls.push(typeof input === "string" ? input : String(input));
        return new Response(
          JSON.stringify({
            success: false,
            error: {
              code: "AUTH_FAILED",
              message: "No active account found with the given credentials.",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    localStorage.setItem("access", "stale-token");
    localStorage.setItem("refresh", "stale-refresh");

    let thrown: unknown;
    try {
      await api("/api/auth/login/", {
        method: "POST",
        json: { email: "x@example.com", password: "wrong" },
      });
    } catch (e) {
      thrown = e;
    }

    // Must throw an ApiError with the server's status and message.
    expect(thrown).toBeInstanceOf(ApiError);
    const err = thrown as ApiError;
    expect(err.status).toBe(401);
    expect(err.message).toBe(
      "No active account found with the given credentials.",
    );

    // Must NOT call the refresh endpoint.
    expect(fetchCallUrls.every((u) => u !== REFRESH_URL)).toBe(true);
    // Only the login call itself should have been made.
    expect(fetchCallUrls).toHaveLength(1);

    // Must NOT wipe the session.
    expect(localStorage.getItem("access")).toBe("stale-token");
    expect(localStorage.getItem("refresh")).toBe("stale-refresh");
    // Must NOT wipe unrelated keys.
    expect(localStorage.getItem("org")).toBe("42");

    // Must NOT redirect.
    expect(hrefSpy).not.toHaveBeenCalled();
  });

  it("does not send Authorization header for auth-path requests even when a stale token is in storage", async () => {
    localStorage.setItem("access", "stale-token");

    let capturedHeaders: Record<string, string> | undefined;
    vi.stubGlobal(
      "fetch",
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string> | undefined;
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "X", message: "X" },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    try {
      await api("/api/auth/login/", {
        method: "POST",
        json: { email: "x@example.com", password: "wrong" },
      });
    } catch {
      // expected
    }

    expect(capturedHeaders?.["Authorization"]).toBeUndefined();
    expect(capturedHeaders?.["X-Organization-ID"]).toBeUndefined();
  });

  it("clears the session and redirects for a protected-path 401 when refresh also fails", async () => {
    localStorage.setItem("access", "old");
    localStorage.setItem("refresh", "bad");

    // Track href assignments.
    const hrefSpy = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      pathname: "/dashboard",
      get href() {
        return window.location.href;
      },
      set href(v: string) {
        hrefSpy(v);
      },
    });

    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        // All requests return 401 (including the refresh attempt).
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "E", message: "E" },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    try {
      await api("/api/protected/");
    } catch {
      // expected ApiError
    }

    expect(localStorage.getItem("access")).toBeNull();
    expect(localStorage.getItem("refresh")).toBeNull();
    expect(hrefSpy).toHaveBeenCalledWith("/login");
  });
});

describe("fetchAllPages", () => {
  it("returns results from each page in order", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page");
      const body =
        page === "2"
          ? {
              next: "http://localhost:8000/api/tasks/?page=3",
              results: [{ id: 2 }],
            }
          : page === "3"
            ? { next: null, results: [{ id: 3 }] }
            : {
                next: "http://localhost:8000/api/tasks/?page=2",
                results: [{ id: 1 }],
              };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();

    try {
      await expect(
        fetchAllPages<{ id: number }>("/api/tasks/?page=1"),
      ).resolves.toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        "http://localhost:8000/api/tasks/?page=1",
        "http://localhost:8000/api/tasks/?page=2",
        "http://localhost:8000/api/tasks/?page=3",
      ]);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("stops after the page cap", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page") ?? "1");
      return new Response(
        JSON.stringify({
          next: `http://localhost:8000/api/tasks/?page=${page + 1}`,
          results: [{ id: page }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();

    try {
      const results = await fetchAllPages<{ id: number }>("/api/tasks/?page=1");

      expect(results).toHaveLength(50);
      expect(results[0]).toEqual({ id: 1 });
      expect(results[49]).toEqual({ id: 50 });
      expect(fetchMock).toHaveBeenCalledTimes(50);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
