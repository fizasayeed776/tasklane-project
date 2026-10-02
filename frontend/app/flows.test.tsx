import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useParams: () => ({ id: "1" }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: mocks.api };
});

import Login from "./login/page";
import ProjectPage from "./projects/[id]/page";

function renderProjectPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectPage />
    </QueryClientProvider>,
  );
}

describe("frontend user flows", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.push.mockReset();
  });

  it("logs in, stores the session, and navigates to the dashboard", async () => {
    mocks.api.mockResolvedValue({
      access: "access-token",
      refresh: "refresh-token",
    });
    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "person@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "StrongPass!234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/auth/login/", {
        method: "POST",
        json: { email: "person@example.com", password: "StrongPass!234" },
      });
      expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    });
    expect(localStorage.getItem("access")).toBe("access-token");
    expect(localStorage.getItem("refresh")).toBe("refresh-token");
  });

  it("creates a task in the current project", async () => {
    mocks.api.mockImplementation(async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
      if (endpoint === "/api/projects/1/") {
        return { id: 1, organization: 2, name: "Roadmap", description: "", status: "ACTIVE", created_by: 1 };
      }
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme", role: "MEMBER" }];
      }
      if (endpoint === "/api/organizations/2/members/") {
        return [{ id: 3, user_id: 5, email: "member@example.com", name: "Member", role: "MEMBER" }];
      }
      if (endpoint.startsWith("/api/tasks/?")) return { results: [] };
      if (endpoint === "/api/tasks/" && init?.method === "POST") {
        return { id: 42, project: 1, title: "Write release notes", status: "TODO" };
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });
    renderProjectPage();

    fireEvent.change(await screen.findByPlaceholderText("New task title"), {
      target: { value: "Write release notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/tasks/", {
        method: "POST",
        json: {
          project: 1,
          title: "Write release notes",
          assigned_to: null,
        },
      });
    });
  });

  it("hides task creation and deletion controls from viewers", async () => {
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/projects/1/") {
        return { id: 1, organization: 2, name: "Roadmap", description: "", status: "ACTIVE", created_by: 1 };
      }
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme", role: "VIEWER" }];
      }
      if (endpoint === "/api/organizations/2/members/") return [];
      if (endpoint.startsWith("/api/tasks/?")) return { results: [] };
      throw new Error(`Unexpected API call: ${endpoint}`);
    });
    renderProjectPage();

    expect(await screen.findByText("VIEWER")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite member" })).not.toBeInTheDocument();
  });
});
