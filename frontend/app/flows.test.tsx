import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
  useParams: () => ({ id: "1" }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: mocks.api };
});

import Login from "./login/LoginForm";
import ProjectPage from "./(app)/projects/[id]/ProjectClient";
import TaskPage from "./(app)/tasks/[id]/TaskClient";
import AppShell from "./components/AppShell";
import { ToastProvider } from "./components/ToastProvider";
import Dashboard from "./(app)/dashboard/DashboardClient";

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(
    public url: string | URL,
    public protocols?: string | string[],
  ) {
    MockWebSocket.instances.push(this);
  }

  close() {}
}

function renderProjectPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ProjectPage id="1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

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

function renderAppShell() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AppShell>
        <main>Workspace content</main>
      </AppShell>
    </QueryClientProvider>,
  );
}

function renderTaskPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <TaskPage id="1" />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function mockProjectPageApi(tasks: unknown[] = []) {
  mocks.api.mockImplementation(
    async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
      if (endpoint === "/api/projects/1/") {
        return {
          id: 1,
          organization: 2,
          name: "Roadmap",
          description: "",
          status: "ACTIVE",
          created_by: 1,
        };
      }
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme", role: "MEMBER" }];
      }
      if (endpoint === "/api/organizations/2/members/") {
        return [
          {
            id: 3,
            user_id: 5,
            email: "member@example.com",
            name: "Member",
            role: "MEMBER",
          },
        ];
      }
      if (endpoint.startsWith("/api/tasks/?")) return { results: tasks };
      if (endpoint.startsWith("/api/tasks/") && init?.method === "PATCH") {
        return {};
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    },
  );
}

describe("frontend user flows", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.push.mockReset();
    mocks.replace.mockReset();
    mocks.replace.mockImplementation((url: string) =>
      window.history.replaceState({}, "", url),
    );
    window.history.replaceState({}, "", "/projects/1");
    MockWebSocket.instances = [];
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("shows password visibility toggle on the login form", () => {
    render(<Login />);
    const password = screen.getByPlaceholderText("Password");
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("switches organizations from the authenticated top bar and displays roles", async () => {
    localStorage.setItem("org", "2");
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/") {
        return [
          { id: 2, name: "Acme", role: "OWNER" },
          { id: 3, name: "Studio", role: "VIEWER" },
        ];
      }
      if (endpoint === "/api/auth/me/") {
        return {
          id: 5,
          email: "owner@example.com",
          display_name: "Avery",
        };
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });
    renderAppShell();

    const switcher = screen.getByRole("button", {
      name: "Organization switcher",
    });
    await waitFor(() => expect(switcher).toHaveTextContent("Acme"));
    const organizationChevron = switcher.querySelector("svg");
    expect(organizationChevron).toHaveAttribute("aria-hidden", "true");
    expect(organizationChevron).toHaveAttribute("focusable", "false");
    expect(organizationChevron).toHaveAttribute("width", "16");
    expect(organizationChevron).toHaveAttribute("height", "16");
    expect(organizationChevron).toHaveAttribute("stroke", "currentColor");
    expect(organizationChevron).toHaveAttribute("stroke-width", "2");
    expect(organizationChevron).toHaveClass(
      "transition-transform",
      "duration-150",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Organization switcher" }),
    );
    expect(organizationChevron).toHaveClass("rotate-180");
    expect(
      screen.getByRole("menuitem", { name: /Studio.*Viewer/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Studio.*Viewer/ }));

    await waitFor(() => expect(localStorage.getItem("org")).toBe("3"));
  });

  it("keeps navbar dropdowns exclusive, dismissible, and keyboard accessible", async () => {
    localStorage.setItem("access", "short-lived-access-token");
    localStorage.setItem("org", "2");
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme", role: "OWNER" }];
      }
      if (endpoint === "/api/auth/me/") {
        return { email: "owner@example.com", display_name: "Avery" };
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });
    vi.stubGlobal("WebSocket", MockWebSocket);
    renderAppShell();

    const notificationsButton = await screen.findByRole("button", {
      name: "Notifications",
    });
    const userButton = screen.getByRole("button", { name: "User menu" });

    expect(notificationsButton).toHaveAttribute("aria-expanded", "false");
    expect(userButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(notificationsButton);
    expect(notificationsButton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("heading", { name: "Recent notifications" }),
    ).toBeInTheDocument();
    fireEvent.click(notificationsButton);
    expect(notificationsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(notificationsButton);

    fireEvent.click(userButton);
    expect(notificationsButton).toHaveAttribute("aria-expanded", "false");
    expect(userButton).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.queryByRole("heading", { name: "Recent notifications" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();

    fireEvent.click(userButton);
    expect(userButton).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("button", { name: "Log out" }),
    ).not.toBeInTheDocument();

    fireEvent.click(notificationsButton);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(notificationsButton).toHaveAttribute("aria-expanded", "false");
    expect(notificationsButton).toHaveFocus();

    fireEvent.click(userButton);
    fireEvent.pointerDown(screen.getByText("Workspace content"));
    expect(userButton).toHaveAttribute("aria-expanded", "false");
  });

  it("creates a task from the new-task modal", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/projects/1/") {
          return {
            id: 1,
            organization: 2,
            name: "Roadmap",
            description: "",
            status: "ACTIVE",
            created_by: 1,
          };
        }
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role: "MEMBER" }];
        }
        if (endpoint === "/api/organizations/2/members/") {
          return [
            {
              id: 3,
              user_id: 5,
              email: "member@example.com",
              name: "Member",
              role: "MEMBER",
            },
          ];
        }
        if (endpoint.startsWith("/api/tasks/?")) return { results: [] };
        if (endpoint === "/api/tasks/" && init?.method === "POST") {
          return {
            id: 42,
            project: 1,
            title: "Write release notes",
            status: "TODO",
          };
        }
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderProjectPage();

    fireEvent.click(await screen.findByRole("button", { name: "New task" }));
    expect(
      await screen.findByRole("dialog", { name: "New task" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Write release notes" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Summarize the latest release." },
    });
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "HIGH" },
    });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-11-12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/tasks/", {
        method: "POST",
        json: {
          project: 1,
          title: "Write release notes",
          description: "Summarize the latest release.",
          priority: "HIGH",
          assigned_to: null,
          due_date: "2026-11-12",
        },
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("builds task API URLs from the selected filters", async () => {
    mockProjectPageApi();
    renderProjectPage();

    await screen.findByRole("heading", { name: "Roadmap" });
    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "IN_PROGRESS" },
    });
    fireEvent.change(screen.getByLabelText("Filter by priority"), {
      target: { value: "HIGH" },
    });
    fireEvent.change(screen.getByLabelText("Filter by assignee"), {
      target: { value: "5" },
    });

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/tasks/?project=1&status=IN_PROGRESS&priority=HIGH&assigned_to=5",
      ),
    );
    expect(window.location.search).toBe(
      "?status=IN_PROGRESS&priority=HIGH&assigned_to=5",
    );
  });

  it("applies combined filters from the URL when loading the board", async () => {
    window.history.replaceState(
      {},
      "",
      "/projects/1?search=launch&status=TODO&priority=HIGH&assigned_to=5",
    );
    mockProjectPageApi();
    renderProjectPage();

    expect(await screen.findByLabelText("Search tasks")).toHaveValue("launch");
    expect(screen.getByLabelText("Filter by status")).toHaveValue("TODO");
    expect(screen.getByLabelText("Filter by priority")).toHaveValue("HIGH");
    await screen.findByRole("option", { name: "Member" });
    expect(screen.getByLabelText("Filter by assignee")).toHaveValue("5");
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/tasks/?project=1&search=launch&status=TODO&priority=HIGH&assigned_to=5",
      ),
    );
  });

  it("clears all filters from the controls and URL", async () => {
    window.history.replaceState(
      {},
      "",
      "/projects/1?search=launch&status=TODO&priority=HIGH&assigned_to=5",
    );
    mockProjectPageApi();
    renderProjectPage();

    await screen.findByLabelText("Search tasks");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(window.location.pathname + window.location.search).toBe(
      "/projects/1",
    );
    expect(screen.getByLabelText("Search tasks")).toHaveValue("");
    expect(screen.getByLabelText("Filter by status")).toHaveValue("");
    expect(screen.getByLabelText("Filter by priority")).toHaveValue("");
    expect(screen.getByLabelText("Filter by assignee")).toHaveValue("");
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/tasks/?project=1"),
    );
  });

  it("sends a PATCH when dragging a task to another Kanban column", async () => {
    const task = {
      id: 10,
      project: 1,
      organization: 2,
      title: "Prepare launch plan",
      description: "",
      status: "TODO",
      priority: "HIGH",
      assigned_to: null,
      assigned_to_name: null,
      created_by: 5,
      created_by_name: "Avery",
      due_date: null,
    };
    mockProjectPageApi([task]);
    renderProjectPage();

    const card = (await screen.findByText("Prepare launch plan")).closest(
      "article",
    );
    expect(card).not.toBeNull();
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "10"),
    };
    fireEvent.dragStart(card!, { dataTransfer });
    fireEvent.drop(screen.getByLabelText("In progress tasks"), {
      dataTransfer,
    });

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/tasks/10/", {
        method: "PATCH",
        json: { status: "IN_PROGRESS" },
      }),
    );
  });

  it("rolls back a failed drag-and-drop task move and shows a toast", async () => {
    const task = {
      id: 10,
      project: 1,
      organization: 2,
      title: "Prepare launch plan",
      description: "",
      status: "TODO",
      priority: "HIGH",
      assigned_to: null,
      assigned_to_name: null,
      created_by: 5,
      created_by_name: "Avery",
      due_date: null,
    };
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/projects/1/") {
          return {
            id: 1,
            organization: 2,
            name: "Roadmap",
            description: "",
            status: "ACTIVE",
            created_by: 1,
          };
        }
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role: "MEMBER" }];
        }
        if (endpoint === "/api/organizations/2/members/") return [];
        if (endpoint.startsWith("/api/tasks/?")) return { results: [task] };
        if (endpoint === "/api/tasks/10/" && init?.method === "PATCH") {
          throw new Error("Network unavailable");
        }
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderProjectPage();

    const card = (await screen.findByText("Prepare launch plan")).closest(
      "article",
    );
    expect(card).not.toBeNull();
    const dataTransfer = {
      setData: vi.fn(),
      getData: vi.fn(() => "10"),
    };
    fireEvent.dragStart(card!, { dataTransfer });
    fireEvent.drop(screen.getByLabelText("In progress tasks"), {
      dataTransfer,
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't move task. Reverted.",
    );
    await waitFor(() =>
      expect(screen.getByLabelText("To do tasks")).toContainElement(card),
    );
    expect(mocks.api).toHaveBeenCalledWith("/api/tasks/10/", {
      method: "PATCH",
      json: { status: "IN_PROGRESS" },
    });
  });

  it("opens project edit and archive actions from the header menu", async () => {
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/projects/1/") {
        return {
          id: 1,
          organization: 2,
          name: "Roadmap",
          description: "",
          status: "ACTIVE",
          created_by: 1,
        };
      }
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme", role: "OWNER" }];
      }
      if (endpoint === "/api/organizations/2/members/") return [];
      if (endpoint.startsWith("/api/tasks/?")) return { results: [] };
      throw new Error(`Unexpected API call: ${endpoint}`);
    });
    renderProjectPage();

    fireEvent.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit project" }));
    expect(
      screen.getByRole("button", { name: "Save project" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Project actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Archive project" }));
    expect(
      await screen.findByRole("alertdialog", {
        name: "Archive this project?",
      }),
    ).toBeInTheDocument();
  });

  it("confirms task deletion before sending the delete request", async () => {
    const task = {
      id: 10,
      project: 1,
      organization: 2,
      title: "Old draft",
      description: "",
      status: "TODO",
      priority: "LOW",
      assigned_to: null,
      assigned_to_name: null,
      created_by: 5,
      created_by_name: "Avery",
      due_date: null,
    };
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/projects/1/") {
          return {
            id: 1,
            organization: 2,
            name: "Roadmap",
            description: "",
            status: "ACTIVE",
            created_by: 1,
          };
        }
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role: "OWNER" }];
        }
        if (endpoint === "/api/organizations/2/members/") return [];
        if (endpoint.startsWith("/api/tasks/?")) return { results: [task] };
        if (endpoint === "/api/tasks/10/" && init?.method === "DELETE") {
          return undefined;
        }
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderProjectPage();

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(
      await screen.findByRole("alertdialog", { name: "Delete “Old draft”?" }),
    ).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalledWith(
      "/api/tasks/10/",
      expect.objectContaining({ method: "DELETE" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete task" }));
    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/tasks/10/", {
        method: "DELETE",
      });
    });
  });

  it("hides task creation and deletion controls from viewers", async () => {
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/projects/1/") {
        return {
          id: 1,
          organization: 2,
          name: "Roadmap",
          description: "",
          status: "ACTIVE",
          created_by: 1,
        };
      }
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme", role: "VIEWER" }];
      }
      if (endpoint === "/api/organizations/2/members/") return [];
      if (endpoint.startsWith("/api/tasks/?")) return { results: [] };
      throw new Error(`Unexpected API call: ${endpoint}`);
    });
    renderProjectPage();

    expect(await screen.findByText("Viewer")).toBeInTheDocument();
    expect(
      await screen.findByText("0 tasks · 0 done · 0 members"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Organization members (0)" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "New task" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Invite member" }),
    ).not.toBeInTheDocument();
  });

  it.each(["VIEWER", "MEMBER"])(
    "%s cannot see project administration buttons",
    async (role) => {
      mocks.api.mockImplementation(async (endpoint: string) => {
        if (endpoint === "/api/projects/1/") {
          return {
            id: 1,
            organization: 2,
            name: "Roadmap",
            description: "",
            status: "ACTIVE",
            created_by: 1,
          };
        }
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role }];
        }
        if (endpoint === "/api/organizations/2/members/") return [];
        if (endpoint.startsWith("/api/tasks/?")) return { results: [] };
        throw new Error(`Unexpected API call: ${endpoint}`);
      });
      renderProjectPage();

      const roleLabel = role[0] + role.slice(1).toLowerCase();
      expect(await screen.findByText(roleLabel)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Project actions" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Invite member" }),
      ).not.toBeInTheDocument();
      if (role === "VIEWER") {
        expect(
          screen.queryByRole("button", { name: "New task" }),
        ).not.toBeInTheDocument();
      } else {
        expect(
          await screen.findByRole("button", { name: "New task" }),
        ).toBeInTheDocument();
      }
    },
  );

  it("shows the API's validation message when an organization invite fails", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role: "OWNER" }];
        }
        if (endpoint === "/api/organizations/2/members/") {
          if (init?.method === "POST")
            throw new Error("No registered user with that email.");
          return [];
        }
        if (endpoint === "/api/dashboard/") return {};
        if (endpoint === "/api/projects/?ordering=-created_at")
          return { results: [] };
        if (endpoint === "/api/activity/") return [];
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Invite member" }),
    );
    fireEvent.change(await screen.findByPlaceholderText("Member email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(
      await screen.findAllByText("No registered user with that email."),
    ).not.toHaveLength(0);
  });

  it("confirms a pending invitation and clears the invite form on success", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role: "OWNER" }];
        }
        if (endpoint === "/api/organizations/2/members/") {
          if (init?.method === "POST")
            return { email: "new@example.com", role: "VIEWER", pending: true };
          return [];
        }
        if (endpoint === "/api/dashboard/") return {};
        if (endpoint === "/api/projects/?ordering=-created_at")
          return { results: [] };
        if (endpoint === "/api/activity/") return [];
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Invite member" }),
    );
    const email = await screen.findByPlaceholderText("Member email");
    for (const label of [
      "Create organization",
      "New project",
      "Send invitation",
    ]) {
      expect(screen.getByRole("button", { name: label })).toHaveClass(
        "whitespace-nowrap",
        "shrink-0",
      );
    }
    fireEvent.change(email, { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(
      await screen.findByText(
        "Invitation sent to new@example.com. They can register to join.",
      ),
    ).toBeInTheDocument();
    expect(email).toHaveValue("");
    expect(mocks.api).toHaveBeenCalledWith(
      "/api/organizations/2/members/",
      expect.objectContaining({
        method: "POST",
        json: { email: "new@example.com", role: "MEMBER" },
      }),
    );
  });

  it.each(["VIEWER", "MEMBER"])(
    "%s cannot see organization management controls",
    async (role) => {
      mocks.api.mockImplementation(async (endpoint: string) => {
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role }];
        }
        if (endpoint === "/api/organizations/2/members/") {
          return [
            {
              id: 3,
              user_id: 5,
              email: "member@example.com",
              name: "Member",
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
      renderDashboard();

      expect(
        await screen.findByRole("heading", {
          name: "Organization members (1)",
        }),
      ).toBeInTheDocument();
      expect(
        screen.queryByPlaceholderText("Member email"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Invite member" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Create organization" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "New project" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Remove" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Member role")).not.toBeInTheDocument();
    },
  );

  it("creates a project from the new-project dialog", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role: "OWNER" }];
        }
        if (endpoint === "/api/organizations/2/members/") return [];
        if (endpoint === "/api/dashboard/") return {};
        if (endpoint === "/api/projects/" && init?.method === "POST") {
          return {
            id: 12,
            organization: 2,
            name: "Field notes",
            description: "",
            status: "ACTIVE",
            created_by: 1,
          };
        }
        if (endpoint === "/api/projects/?ordering=-created_at") {
          return { results: [] };
        }
        if (endpoint === "/api/activity/") return [];
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderDashboard();

    const openProjectDialog = await screen.findByRole("button", {
      name: "New project",
    });
    openProjectDialog.focus();
    fireEvent.click(openProjectDialog);
    expect(
      await screen.findByRole("dialog", { name: "New project" }),
    ).toBeInTheDocument();
    let projectName = screen.getByPlaceholderText("Project name");
    expect(projectName).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(
      screen.getByRole("button", { name: "Create project" }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(projectName).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(openProjectDialog).toHaveFocus();
    fireEvent.click(openProjectDialog);
    projectName = await screen.findByPlaceholderText("Project name");
    expect(projectName).toHaveFocus();
    fireEvent.change(projectName, {
      target: { value: "Field notes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/projects/", {
        method: "POST",
        json: { name: "Field notes", organization_id: 2 },
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "New project" })).toHaveFocus();
  });

  it("shows project counts, status, last task activity, and linked activity", async () => {
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme", role: "MEMBER" }];
      }
      if (endpoint === "/api/organizations/2/members/") return [];
      if (endpoint === "/api/dashboard/") {
        return {
          total_projects: 1,
          total_tasks: 2,
          assigned_to_me: 1,
          completed: 1,
          overdue: 0,
        };
      }
      if (endpoint === "/api/projects/?ordering=-created_at") {
        return {
          results: [
            {
              id: 8,
              organization: 2,
              name: "Field notes",
              description: "",
              status: "ACTIVE",
              created_by: 1,
              created_at: "2026-09-30T10:00:00Z",
            },
          ],
        };
      }
      if (endpoint === "/api/tasks/?project=8") {
        return {
          count: 2,
          next: null,
          results: [
            {
              created_at: "2026-09-30T10:00:00Z",
              updated_at: "2026-10-02T10:00:00Z",
            },
          ],
        };
      }
      if (endpoint === "/api/activity/") {
        return [
          {
            id: 4,
            task: 42,
            verb: "comment_added",
            message: "Avery commented on a task.",
            created_at: "2026-10-02T10:00:00Z",
          },
        ];
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });
    renderDashboard();

    expect(await screen.findByText("2 tasks")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View task" })).toHaveAttribute(
      "href",
      "/tasks/42",
    );
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("requires confirmation before removing an organization member", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role: "OWNER" }];
        }
        if (endpoint === "/api/organizations/2/members/") {
          if (init?.method === "DELETE") return undefined;
          return [
            {
              id: 3,
              user_id: 5,
              email: "member@example.com",
              name: "Morgan Lee",
              role: "MEMBER",
            },
          ];
        }
        if (endpoint === "/api/dashboard/") return {};
        if (endpoint === "/api/projects/?ordering=-created_at")
          return { results: [] };
        if (endpoint === "/api/activity/") return [];
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderDashboard();

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove", exact: true }),
    );
    expect(
      await screen.findByRole("alertdialog", {
        name: "Remove Morgan Lee?",
      }),
    ).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalledWith(
      "/api/organizations/2/members/3/",
      expect.objectContaining({ method: "DELETE" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove member" }));
    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/organizations/2/members/3/",
        { method: "DELETE" },
      );
    });
  });

  it("hides task edit and comment controls from viewers", async () => {
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/tasks/1/") {
        return {
          id: 1,
          project: 7,
          organization: 2,
          title: "Restricted task",
          description: "",
          status: "TODO",
          priority: "MEDIUM",
          assigned_to: null,
          created_by: 5,
        };
      }
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme", role: "VIEWER" }];
      }
      if (endpoint === "/api/auth/me/") return { id: 5 };
      if (endpoint === "/api/tasks/1/comments/") {
        return [
          {
            id: 9,
            user: 5,
            user_name: "Viewer",
            content: "Read-only comment",
          },
        ];
      }
      if (endpoint === "/api/tasks/1/activity/") return [];
      throw new Error(`Unexpected API call: ${endpoint}`);
    });
    renderTaskPage();

    expect(
      await screen.findByRole("heading", { name: "Comments" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit task" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByPlaceholderText("Write a comment")).toBeNull();
  });

  it("lets members edit their own comments and keeps empty comments disabled", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/tasks/1/") {
          return {
            id: 1,
            project: 7,
            organization: 2,
            title: "Draft roadmap",
            description: "First pass",
            status: "TODO",
            priority: "MEDIUM",
            assigned_to: 5,
            assigned_to_name: "Avery",
            created_by: 5,
            created_by_name: "Avery",
            due_date: null,
            created_at: "2026-10-01T10:00:00Z",
          };
        }
        if (endpoint === "/api/organizations/") {
          return [{ id: 2, name: "Acme", role: "MEMBER" }];
        }
        if (endpoint === "/api/auth/me/") {
          return { id: 5, display_name: "Avery" };
        }
        if (endpoint === "/api/organizations/2/members/") {
          return [
            {
              id: 3,
              user_id: 5,
              email: "avery@example.com",
              name: "Avery",
              role: "MEMBER",
            },
          ];
        }
        if (endpoint === "/api/tasks/1/comments/") {
          return [
            {
              id: 9,
              user: 5,
              user_name: "Avery",
              content: "Check the milestones.",
              created_at: "2026-10-02T10:00:00Z",
              updated_at: "2026-10-02T10:00:00Z",
            },
          ];
        }
        if (endpoint === "/api/tasks/1/activity/") return [];
        if (endpoint === "/api/comments/9/" && init?.method === "PATCH") {
          return undefined;
        }
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderTaskPage();

    expect(
      await screen.findByRole("heading", { name: "Task details" }),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const commentButton = screen.getByRole("button", { name: "Comment" });
    expect(commentButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Edit comment"), {
      target: { value: "Check dates and milestones." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save comment" }));

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/comments/9/", {
        method: "PATCH",
        json: { content: "Check dates and milestones." },
      });
    });
    fireEvent.change(screen.getByPlaceholderText("Write a comment"), {
      target: { value: "A new note" },
    });
    expect(commentButton).toBeEnabled();
    expect(screen.getAllByText("Avery").length).toBeGreaterThan(0);
  });

  it("receives scoped notifications in the navbar without polling", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    localStorage.setItem("access", "short-lived-access-token");
    localStorage.setItem("org", "2");
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/") {
        return [{ id: 2, name: "Acme", role: "OWNER" }];
      }
      if (endpoint === "/api/auth/me/") {
        return { email: "owner@example.com", display_name: "Avery" };
      }
      throw new Error(`Unexpected API call: ${endpoint}`);
    });
    renderAppShell();

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    expect(String(socket.url)).toContain("organization_id=2");
    expect(String(socket.url)).not.toContain("token=");
    expect(socket.protocols).toEqual([
      "tasklane",
      "jwt.short-lived-access-token",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    socket.onmessage?.({
      data: JSON.stringify({
        id: "event-1",
        type: "comment_added",
        organization_id: 2,
        task_id: 8,
        message: "A teammate commented.",
        created_at: "2026-10-02T18:00:00Z",
      }),
    } as MessageEvent);

    expect(
      await screen.findByRole("link", { name: "A teammate commented." }),
    ).toHaveAttribute("href", "/tasks/8");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Mark notification as read: A teammate commented.",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();
  });
});
