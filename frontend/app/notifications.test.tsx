import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: mocks.api,
    refreshSession: vi.fn(async () => true),
    setOrganization: (id: string) => {
      localStorage.setItem("org", id);
      window.dispatchEvent(new Event("tasklane:organization"));
    },
  };
});

import NotificationsClient from "./(app)/notifications/NotificationsClient";
import NotificationsNavbar from "./components/NotificationsNavbar";
import { ToastProvider } from "./components/ToastProvider";
import { config } from "../middleware";

const notification = {
  id: 17,
  event_type: "comment_added",
  message: "A teammate commented on the task.",
  organization: { id: 7, name: "Design" },
  task: 44,
  read: false,
  read_at: null,
  created_at: "2026-10-01T12:00:00Z",
};

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

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

function page(results = [notification], next: string | null = null) {
  return { count: results.length, next, previous: null, results };
}

describe("notification centre", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.push.mockReset();
    MockWebSocket.instances = [];
    localStorage.clear();
  });

  it("links the bell to the notifications page and shows or hides the unread badge", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    localStorage.setItem("access", "access-token");
    localStorage.setItem("org", "7");
    mocks.api.mockResolvedValue({ count: 12 });

    const { unmount } = renderWithProviders(<NotificationsNavbar />);

    const bell = await screen.findByRole("link", {
      name: "Notifications (12 unread)",
    });
    expect(bell).toHaveAttribute("href", "/notifications");
    expect(screen.getByText("9+")).toBeInTheDocument();
    expect(MockWebSocket.instances.length).toBeGreaterThan(0);

    unmount();
    mocks.api.mockResolvedValue({ count: 0 });
    renderWithProviders(<NotificationsNavbar />);
    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Notifications" }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("9+")).not.toBeInTheDocument();
  });

  it("lists notifications, filters unread, and loads another page", async () => {
    const second = {
      ...notification,
      id: 18,
      read: true,
      read_at: "2026-10-02T00:00:00Z",
    };
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/notifications/unread-count/") return { count: 1 };
      if (path === "/api/notifications/?page=1")
        return page([notification], "?page=2");
      if (path === "/api/notifications/?page=2") return page([second]);
      if (path === "/api/notifications/?unread=true&page=1") {
        return page([notification]);
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithProviders(<NotificationsClient />);

    expect(
      await screen.findByRole("button", {
        name: /A teammate commented on the task/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Design")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Unread" }));
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/notifications/?unread=true&page=1",
      ),
    );
    expect(await screen.findByText("Design")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "All" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
    expect(
      await screen.findByRole("button", {
        name: /A teammate commented on the task/,
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith("/api/notifications/?page=2"),
    );
    expect(screen.getAllByText("Comment Added")).toHaveLength(2);
  });

  it("marks a notification read and switches organization before task navigation", async () => {
    mocks.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/notifications/unread-count/") return { count: 1 };
      if (path === "/api/notifications/?page=1") return page();
      if (path === "/api/notifications/17/read/" && init?.method === "POST") {
        return { ...notification, read: true, read_at: "2026-10-03T00:00:00Z" };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    localStorage.setItem("org", "2");
    mocks.push.mockImplementation(() => {
      expect(localStorage.getItem("org")).toBe("7");
    });

    renderWithProviders(<NotificationsClient />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /A teammate commented on the task/,
      }),
    );

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/notifications/17/read/", {
        method: "POST",
      });
      expect(mocks.push).toHaveBeenCalledWith("/tasks/44");
    });
  });

  it("marks all as read", async () => {
    mocks.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/notifications/unread-count/") return { count: 1 };
      if (path === "/api/notifications/?page=1") return page();
      if (
        path === "/api/notifications/mark-all-read/" &&
        init?.method === "POST"
      ) {
        return { updated: 1 };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });

    renderWithProviders(<NotificationsClient />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Mark all as read" }),
    );

    await waitFor(() =>
      expect(mocks.api).toHaveBeenCalledWith(
        "/api/notifications/mark-all-read/",
        { method: "POST" },
      ),
    );
  });

  it("shows the empty states and handles a deleted task", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/notifications/unread-count/") return { count: 0 };
      if (path === "/api/notifications/?page=1") return page([]);
      if (path === "/api/notifications/?unread=true&page=1") return page([]);
      throw new Error(`Unexpected API call: ${path}`);
    });
    const { unmount } = renderWithProviders(<NotificationsClient />);
    expect(
      await screen.findByText("No notifications yet."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Unread" }));
    expect(
      await screen.findByText("You're all caught up."),
    ).toBeInTheDocument();

    unmount();
    const deletedTask = { ...notification, task: null };
    mocks.api.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/notifications/unread-count/") return { count: 1 };
      if (path === "/api/notifications/?page=1") return page([]);
      if (path === "/api/notifications/?unread=true&page=1") {
        return page([deletedTask]);
      }
      if (path === "/api/notifications/17/read/" && init?.method === "POST") {
        return { ...deletedTask, read: true };
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderWithProviders(<NotificationsClient />);
    fireEvent.click(await screen.findByRole("tab", { name: "Unread" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /A teammate commented on the task/,
      }),
    );
    expect(
      await screen.findByText("This task no longer exists."),
    ).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps an API read failure visible as a toast", async () => {
    mocks.api.mockImplementation(async (path: string) => {
      if (path === "/api/notifications/unread-count/") return { count: 1 };
      if (path === "/api/notifications/?page=1") return page();
      if (path === "/api/notifications/17/read/") {
        throw new Error("Could not mark notification as read.");
      }
      throw new Error(`Unexpected API call: ${path}`);
    });
    renderWithProviders(<NotificationsClient />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: /A teammate commented on the task/,
      }),
    );
    expect(
      await screen.findByText("Could not mark notification as read."),
    ).toBeInTheDocument();
  });

  it("shows a websocket toast with a View action and protects the route", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    localStorage.setItem("access", "access-token");
    localStorage.setItem("org", "7");
    mocks.api.mockResolvedValue({ count: 0 });
    renderWithProviders(<NotificationsNavbar />);

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    MockWebSocket.instances[MockWebSocket.instances.length - 1].onmessage?.({
      data: JSON.stringify({
        id: 98,
        type: "task_assigned",
        organization_id: 7,
        task_id: 44,
        message: "You were assigned a task.",
        created_at: "2026-10-03T00:00:00Z",
      }),
    } as MessageEvent);

    expect(
      await screen.findByText("You were assigned a task."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        mocks.api.mock.calls.filter(
          ([path]) => path === "/api/notifications/unread-count/",
        ),
      ).toHaveLength(2);
    });
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    expect(mocks.push).toHaveBeenCalledWith("/tasks/44");
    expect(config.matcher).toContain("/notifications/:path*");
  });
});
