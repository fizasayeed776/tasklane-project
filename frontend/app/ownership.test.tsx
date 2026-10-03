/**
 * Tests for organization ownership management UI:
 *  - Transfer ownership (OWNER only, confirmation dialog)
 *  - Leave organization (non-owner, confirmation dialog)
 *  - Delete organization (OWNER only, name-confirmation dialog)
 *  - Role-based visibility
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// ── helpers ──────────────────────────────────────────────────────────────────

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Dashboard />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsClient />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Standard org list for an owner. Members list has owner + one member. */
function mockOwnerDashboard(extraApiMocks: Record<string, unknown> = {}) {
  mocks.api.mockImplementation(
    async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme Corp", role: "OWNER" }];
      }
      if (endpoint === "/api/organizations/2/members/") {
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
      }
      if (endpoint === "/api/dashboard/") return {};
      if (endpoint === "/api/projects/?ordering=-created_at")
        return { results: [] };
      if (endpoint === "/api/activity/") return [];
      // Allow any extra mocked endpoints to override
      for (const [pattern, result] of Object.entries(extraApiMocks)) {
        if (endpoint === pattern) {
          if (init) {
            // mutation — may be overridden by caller
          }
          return result;
        }
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    },
  );
}

function mockMemberDashboard() {
  mocks.api.mockImplementation(async (endpoint: string) => {
    if (endpoint === "/api/organizations/") {
      return [{ id: 2, name: "Acme Corp", role: "MEMBER" }];
    }
    if (endpoint === "/api/organizations/2/members/") {
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
    }
    if (endpoint === "/api/dashboard/") return {};
    if (endpoint === "/api/projects/?ordering=-created_at")
      return { results: [] };
    if (endpoint === "/api/activity/") return [];
    throw new Error(`Unexpected API call: ${endpoint}`);
  });
}

// ── Role-based visibility ─────────────────────────────────────────────────────

describe("role-based visibility", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    localStorage.setItem("org", "2");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("OWNER sees Transfer ownership button on non-owner members", async () => {
    mockOwnerDashboard();
    renderDashboard();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Transfer ownership to Alice" }),
      ).toBeInTheDocument(),
    );
    // Not on the owner row
    expect(
      screen.queryByRole("button", { name: "Transfer ownership to Owner" }),
    ).not.toBeInTheDocument();
  });

  it("OWNER sees Delete organization in danger zone, not Leave", async () => {
    mockOwnerDashboard();
    renderDashboard();

    expect(
      await screen.findByRole("button", { name: "Delete organization" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Leave organization" }),
    ).not.toBeInTheDocument();
  });

  it("MEMBER does not see Transfer ownership button", async () => {
    mockMemberDashboard();
    renderDashboard();

    await screen.findByText("Organization members (2)");
    expect(
      screen.queryByRole("button", { name: /Transfer ownership/ }),
    ).not.toBeInTheDocument();
  });

  it("MEMBER sees Leave organization in danger zone, not Delete", async () => {
    mockMemberDashboard();
    renderDashboard();

    expect(
      await screen.findByRole("button", { name: "Leave organization" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete organization" }),
    ).not.toBeInTheDocument();
  });

  it.each(["VIEWER", "ADMIN"])(
    "%s does not see Transfer ownership button",
    async (role) => {
      mocks.api.mockImplementation(async (endpoint: string) => {
        if (endpoint === "/api/organizations/")
          return [{ id: 2, name: "Acme Corp", role }];
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
      renderDashboard();

      await screen.findByText("Organization members (2)");
      expect(
        screen.queryByRole("button", { name: /Transfer ownership/ }),
      ).not.toBeInTheDocument();
    },
  );
});

// ── Transfer ownership ────────────────────────────────────────────────────────

describe("transfer ownership", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    localStorage.setItem("org", "2");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("shows confirmation dialog naming the new owner", async () => {
    mockOwnerDashboard();
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Transfer ownership to Alice",
      }),
    );

    expect(
      await screen.findByRole("alertdialog", {
        name: "Transfer ownership to Alice?",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/downgraded to Admin/)).toBeInTheDocument();
  });

  it("cancel closes the dialog without calling the API", async () => {
    mockOwnerDashboard();
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Transfer ownership to Alice",
      }),
    );
    await screen.findByRole("alertdialog", {
      name: "Transfer ownership to Alice?",
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalledWith(
      expect.stringContaining("transfer-ownership"),
      expect.anything(),
    );
  });

  it("confirms transfer and calls the API with the member id", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
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
        if (
          endpoint === "/api/organizations/2/transfer-ownership/" &&
          init?.method === "POST"
        ) {
          return { id: 2, name: "Acme Corp", role: "ADMIN" };
        }
        throw new Error(`Unexpected: ${endpoint}`);
      },
    );
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Transfer ownership to Alice",
      }),
    );
    await screen.findByRole("alertdialog", {
      name: "Transfer ownership to Alice?",
    });
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/organizations/2/transfer-ownership/",
        { method: "POST", json: { member_id: 11 } },
      ),
    );
    // Dialog dismissed
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("shows a toast with the API error message on failure", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
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
        if (
          endpoint === "/api/organizations/2/transfer-ownership/" &&
          init?.method === "POST"
        ) {
          throw new Error("That member does not belong to this organization.");
        }
        throw new Error(`Unexpected: ${endpoint}`);
      },
    );
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Transfer ownership to Alice",
      }),
    );
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    expect(
      await screen.findByText(
        "That member does not belong to this organization.",
      ),
    ).toBeInTheDocument();
  });
});

// ── Leave organization ────────────────────────────────────────────────────────

describe("leave organization", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    localStorage.setItem("org", "2");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("shows leave confirmation dialog with unassignment warning", async () => {
    mockMemberDashboard();
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Leave organization" }),
    );

    expect(
      await screen.findByRole("alertdialog", { name: "Leave Acme Corp?" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/unassigned/i)).toBeInTheDocument();
  });

  it("cancel closes the dialog without calling the API", async () => {
    mockMemberDashboard();
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Leave organization" }),
    );
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalledWith(
      expect.stringContaining("/leave/"),
      expect.anything(),
    );
  });

  it("confirms leave and calls the API, then switches org", async () => {
    let callCount = 0;
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/") {
          // After leave, return empty list
          return callCount++ === 0
            ? [{ id: 2, name: "Acme Corp", role: "MEMBER" }]
            : [];
        }
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
        if (
          endpoint === "/api/organizations/2/leave/" &&
          init?.method === "POST"
        )
          return undefined;
        throw new Error(`Unexpected: ${endpoint}`);
      },
    );
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Leave organization" }),
    );
    const leaveDialog1 = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(leaveDialog1).getByRole("button", { name: "Leave organization" }),
    );

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/organizations/2/leave/", {
        method: "POST",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("shows a toast with the API error message on failure", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/")
          return [{ id: 2, name: "Acme Corp", role: "MEMBER" }];
        if (endpoint === "/api/organizations/2/members/") return [];
        if (endpoint === "/api/dashboard/") return {};
        if (endpoint === "/api/projects/?ordering=-created_at")
          return { results: [] };
        if (endpoint === "/api/activity/") return [];
        if (
          endpoint === "/api/organizations/2/leave/" &&
          init?.method === "POST"
        )
          throw new Error(
            "The organization owner cannot leave. Transfer ownership to another member first.",
          );
        throw new Error(`Unexpected: ${endpoint}`);
      },
    );
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Leave organization" }),
    );
    const leaveDialog2 = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(leaveDialog2).getByRole("button", { name: "Leave organization" }),
    );

    expect(
      await screen.findByText(/Transfer ownership to another member first/i),
    ).toBeInTheDocument();
  });
});

// ── Delete organization ───────────────────────────────────────────────────────

describe("delete organization", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    localStorage.setItem("org", "2");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("shows delete confirmation dialog requiring the org name", async () => {
    mockOwnerDashboard();
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete organization" }),
    );

    expect(
      await screen.findByRole("alertdialog", { name: "Delete Acme Corp?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Organization name confirmation"),
    ).toBeInTheDocument();
  });

  it("delete button is disabled until the correct name is typed", async () => {
    mockOwnerDashboard();
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete organization" }),
    );
    await screen.findByRole("alertdialog");

    const deleteBtn = within(screen.getByRole("alertdialog")).getByRole(
      "button",
      { name: "Delete organization" },
    );
    expect(deleteBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Organization name confirmation"), {
      target: { value: "Wrong" },
    });
    expect(deleteBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Organization name confirmation"), {
      target: { value: "Acme Corp" },
    });
    expect(deleteBtn).not.toBeDisabled();
  });

  it("cancel closes the dialog without calling the API", async () => {
    mockOwnerDashboard();
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete organization" }),
    );
    await screen.findByRole("alertdialog");

    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/organizations/2/"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("confirms delete with correct name and calls DELETE API", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
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
        if (endpoint === "/api/organizations/2/" && init?.method === "DELETE")
          return undefined;
        throw new Error(`Unexpected: ${endpoint}`);
      },
    );
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete organization" }),
    );
    const deleteDialog1 = await screen.findByRole("alertdialog");

    fireEvent.change(screen.getByLabelText("Organization name confirmation"), {
      target: { value: "Acme Corp" },
    });
    fireEvent.click(
      within(deleteDialog1).getByRole("button", {
        name: "Delete organization",
      }),
    );

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/organizations/2/", {
        method: "DELETE",
        json: { name: "Acme Corp" },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("shows API error inside the dialog when delete fails", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
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
          ];
        if (endpoint === "/api/dashboard/") return {};
        if (endpoint === "/api/projects/?ordering=-created_at")
          return { results: [] };
        if (endpoint === "/api/activity/") return [];
        if (endpoint === "/api/organizations/2/" && init?.method === "DELETE")
          throw new Error("The name you entered does not match.");
        throw new Error(`Unexpected: ${endpoint}`);
      },
    );
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete organization" }),
    );
    const deleteDialog2 = await screen.findByRole("alertdialog");

    fireEvent.change(screen.getByLabelText("Organization name confirmation"), {
      target: { value: "Acme Corp" },
    });
    fireEvent.click(
      within(deleteDialog2).getByRole("button", {
        name: "Delete organization",
      }),
    );

    expect(
      await screen.findByText("The name you entered does not match."),
    ).toBeInTheDocument();
    // Dialog stays open on error
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});

// ── Settings page danger zone ─────────────────────────────────────────────────

describe("settings page danger zone", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    localStorage.setItem("org", "2");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("OWNER sees Delete organization in settings danger zone", async () => {
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/")
        return [{ id: 2, name: "Acme Corp", role: "OWNER" }];
      if (endpoint === "/api/auth/me/")
        return { id: 1, email: "owner@example.com" };
      throw new Error(`Unexpected: ${endpoint}`);
    });
    renderSettings();

    expect(
      await screen.findByRole("button", { name: "Delete organization" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Leave organization" }),
    ).not.toBeInTheDocument();
  });

  it("MEMBER sees Leave organization in settings danger zone", async () => {
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/")
        return [{ id: 2, name: "Acme Corp", role: "MEMBER" }];
      if (endpoint === "/api/auth/me/")
        return { id: 1, email: "member@example.com" };
      throw new Error(`Unexpected: ${endpoint}`);
    });
    renderSettings();

    expect(
      await screen.findByRole("button", { name: "Leave organization" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete organization" }),
    ).not.toBeInTheDocument();
  });

  it("settings Leave org calls the API on confirm", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/")
          return [{ id: 2, name: "Acme Corp", role: "MEMBER" }];
        if (endpoint === "/api/auth/me/")
          return { id: 1, email: "member@example.com" };
        if (
          endpoint === "/api/organizations/2/leave/" &&
          init?.method === "POST"
        )
          return undefined;
        throw new Error(`Unexpected: ${endpoint}`);
      },
    );
    renderSettings();

    fireEvent.click(
      await screen.findByRole("button", { name: "Leave organization" }),
    );
    const settingsLeaveDialog = await screen.findByRole("alertdialog", {
      name: "Leave Acme Corp?",
    });
    fireEvent.click(
      within(settingsLeaveDialog).getByRole("button", {
        name: "Leave organization",
      }),
    );

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/organizations/2/leave/", {
        method: "POST",
      }),
    );
  });
});
