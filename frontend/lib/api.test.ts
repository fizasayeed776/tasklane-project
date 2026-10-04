import { afterEach, describe, expect, it, vi } from "vitest";

import { api, clearSession, refreshSession } from "@/lib/api";

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
