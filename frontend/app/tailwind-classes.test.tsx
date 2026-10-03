/**
 * Regression test: no Tailwind class token may be merged with an adjacent one
 * (i.e. no space lost between two utility class names).
 *
 * Affected patterns that have appeared historically:
 *   "font-mediumtext-white"  "px-3text-sm"
 *   "text-smfont-medium"     "font-mediumtext-on-danger"
 *
 * The regex /(font|text|px|py|bg|border)-[a-z0-9-]+(font|text|px|py|bg|border)-/
 * matches any token where a Tailwind prefix immediately follows another class value
 * without a separating space.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: mocks.api };
});

import Dashboard from "./(app)/dashboard/DashboardClient";
import SettingsClient from "./(app)/settings/SettingsClient";
import { ToastProvider } from "./components/ToastProvider";

const MERGED_CLASS_RE =
  /(font|text|px|py|bg|border)-[a-z0-9/-]+(font|text|px|py|bg|border)-/;

function findMergedClasses(container: HTMLElement): string[] {
  const merged: string[] = [];
  container.querySelectorAll("[class]").forEach((el) => {
    const cls = el.getAttribute("class") ?? "";
    cls.split(/\s+/).forEach((token) => {
      if (MERGED_CLASS_RE.test(token)) {
        merged.push(
          `${el.tagName.toLowerCase()}[class="${cls}"] → bad token: "${token}"`,
        );
      }
    });
  });
  return merged;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function mockOwner() {
  mocks.api.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/organizations/")
      return [{ id: 2, name: "Acme Corp", role: "OWNER" }];
    if (endpoint === "/api/organizations/2/members/")
      return [
        {
          id: 10,
          user_id: 1,
          email: "owner@example.com",
          name: "Owner",
          role: "OWNER",
        },
        {
          id: 11,
          user_id: 5,
          email: "alice@example.com",
          name: "Alice",
          role: "MEMBER",
        },
      ];
    if (endpoint === "/api/dashboard/") return {};
    if (endpoint === "/api/projects/?ordering=-created_at")
      return { results: [] };
    if (endpoint === "/api/activity/") return [];
    throw new Error(`Unexpected: ${endpoint}`);
  });
}

function mockMember() {
  mocks.api.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/organizations/")
      return [{ id: 2, name: "Acme Corp", role: "MEMBER" }];
    if (endpoint === "/api/organizations/2/members/") return [];
    if (endpoint === "/api/dashboard/") return {};
    if (endpoint === "/api/projects/?ordering=-created_at")
      return { results: [] };
    if (endpoint === "/api/activity/") return [];
    throw new Error(`Unexpected: ${endpoint}`);
  });
}

describe("Tailwind class merger regression", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    localStorage.setItem("org", "2");
  });

  it("dashboard danger-zone (OWNER – Delete org button) has no merged class tokens", async () => {
    mockOwner();
    const { container, findByRole } = render(
      <QueryClientProvider client={makeClient()}>
        <ToastProvider>
          <Dashboard />
        </ToastProvider>
      </QueryClientProvider>,
    );

    // Wait for the danger zone to render
    await findByRole("button", { name: "Delete organization" });

    const bad = findMergedClasses(container);
    expect(bad).toEqual([]);
  });

  it("dashboard danger-zone (MEMBER – Leave org button) has no merged class tokens", async () => {
    mockMember();
    const { container, findByRole } = render(
      <QueryClientProvider client={makeClient()}>
        <ToastProvider>
          <Dashboard />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await findByRole("button", { name: "Leave organization" });

    const bad = findMergedClasses(container);
    expect(bad).toEqual([]);
  });

  it("settings page has no merged class tokens (OWNER – Delete org)", async () => {
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/")
        return [{ id: 2, name: "Acme Corp", role: "OWNER" }];
      throw new Error(`Unexpected: ${endpoint}`);
    });

    const { container, findByRole } = render(
      <QueryClientProvider client={makeClient()}>
        <ToastProvider>
          <SettingsClient />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await findByRole("button", { name: "Delete organization" });

    const bad = findMergedClasses(container);
    expect(bad).toEqual([]);
  });

  it("settings page has no merged class tokens (MEMBER – Leave org)", async () => {
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/")
        return [{ id: 2, name: "Acme Corp", role: "MEMBER" }];
      throw new Error(`Unexpected: ${endpoint}`);
    });

    const { container, findByRole } = render(
      <QueryClientProvider client={makeClient()}>
        <ToastProvider>
          <SettingsClient />
        </ToastProvider>
      </QueryClientProvider>,
    );

    await findByRole("button", { name: "Leave organization" });

    const bad = findMergedClasses(container);
    expect(bad).toEqual([]);
  });

  it("show-password buttons (PasswordField) have no merged class tokens", async () => {
    // SettingsClient renders two PasswordField components for its forms
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/") return [];
      throw new Error(`Unexpected: ${endpoint}`);
    });

    const { container } = render(
      <QueryClientProvider client={makeClient()}>
        <ToastProvider>
          <SettingsClient />
        </ToastProvider>
      </QueryClientProvider>,
    );

    // Confirm the Show/Hide buttons are present (SettingsClient has multiple PasswordFields)
    const showBtns = container.querySelectorAll("button[aria-label^='Show']");
    expect(showBtns.length).toBeGreaterThan(0);

    const bad = findMergedClasses(container);
    expect(bad).toEqual([]);
  });
});
