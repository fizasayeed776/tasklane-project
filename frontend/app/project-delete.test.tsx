import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  usePathname: () => "/projects/1",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: mocks.api,
    fetchAllPages: async (
      path: string,
      onPage?: (page: { count?: number }) => void,
    ) => {
      const page = await mocks.api(path);
      onPage?.(page);
      return page.results;
    },
  };
});

import Dashboard from "./(app)/dashboard/DashboardClient";
import ProjectPage from "./(app)/projects/[id]/ProjectClient";
import { ToastProvider } from "./components/ToastProvider";

const project = {
  id: 1,
  organization: 2,
  name: "Roadmap",
  description: "",
  status: "ACTIVE",
  created_by: 1,
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithClient(ui: ReactNode, queryClient = createQueryClient()) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function mockApi(
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
  onDelete: () => unknown = () => undefined,
) {
  mocks.api.mockImplementation(
    async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
      if (endpoint === "/api/organizations/")
        return [{ id: 2, name: "Acme", role }];
      if (endpoint === "/api/organizations/2/members/") return [];
      if (endpoint === "/api/projects/1/" && init?.method === "DELETE")
        return onDelete();
      if (endpoint === "/api/projects/1/") return project;
      if (endpoint === "/api/dashboard/") return {};
      if (endpoint === "/api/projects/?ordering=-created_at")
        return { results: [project] };
      if (endpoint === "/api/activity/") return [];
      if (endpoint === "/api/tasks/?project=1")
        return { count: 2, results: [], next: null };
      throw new Error(`Unexpected API call: ${endpoint}`);
    },
  );
}

beforeEach(() => {
  mocks.api.mockReset();
  mocks.push.mockReset();
  mocks.replace.mockReset();
  localStorage.clear();
  localStorage.setItem("org", "2");
});

afterEach(() => {
  cleanup();
});

describe("project deletion permissions", () => {
  it.each(["OWNER", "ADMIN"] as const)(
    "%s can open Delete project from project actions and dashboard",
    async (role) => {
      mockApi(role);
      renderWithClient(<ProjectPage id="1" />);

      fireEvent.click(
        await screen.findByRole("button", { name: "Project actions" }),
      );
      expect(
        await screen.findByRole("button", { name: "Delete project" }),
      ).toBeInTheDocument();

      cleanup();
      renderWithClient(<Dashboard />);
      expect(
        await screen.findByRole("button", { name: "Delete project Roadmap" }),
      ).toBeInTheDocument();
    },
  );

  it.each(["MEMBER", "VIEWER"] as const)(
    "%s cannot see project delete actions",
    async (role) => {
      mockApi(role);
      renderWithClient(<ProjectPage id="1" />);

      expect(
        await screen.findByRole("heading", { name: "Roadmap" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Project actions" }),
      ).not.toBeInTheDocument();

      cleanup();
      renderWithClient(<Dashboard />);
      await screen.findByRole("heading", { name: "Projects" });
      expect(
        screen.queryByRole("button", { name: "Delete project Roadmap" }),
      ).not.toBeInTheDocument();
    },
  );
});

describe("delete project confirmation", () => {
  it("opens the dashboard dialog without navigating and keeps it outside the project list", async () => {
    mockApi("OWNER");
    renderWithClient(<Dashboard />);

    const deleteButton = await screen.findByRole("button", {
      name: "Delete project Roadmap",
    });
    expect(deleteButton.closest("a")).toBeNull();
    expect(deleteButton.classList.contains("w-full")).toBe(false);
    expect(deleteButton.classList.contains("flex-1")).toBe(false);
    fireEvent.click(deleteButton);

    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete project?",
    });
    const projectList = screen
      .getByRole("heading", { name: "Projects" })
      .closest("section")
      ?.querySelector("ul");
    expect(dialog.closest("a")).toBeNull();
    expect(projectList).not.toBeNull();
    expect(projectList?.contains(dialog)).toBe(false);
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByLabelText("Project name confirmation"));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps the project-page dialog outside the actions menu without navigation", async () => {
    mockApi("OWNER");
    renderWithClient(<ProjectPage id="1" />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Project actions" }),
    );
    const menuItem = await screen.findByRole("button", {
      name: "Delete project",
    });
    expect(menuItem.closest("a")).toBeNull();
    fireEvent.click(menuItem);

    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete project?",
    });
    expect(dialog.closest("a")).toBeNull();
    expect(menuItem.parentElement?.contains(dialog)).toBe(false);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("requires the exact project name and restores focus when Escape closes", async () => {
    mockApi("OWNER");
    renderWithClient(<ProjectPage id="1" />);

    const trigger = await screen.findByRole("button", {
      name: "Project actions",
    });
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete project" }),
    );

    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete project?",
    });
    expect(
      await within(dialog).findByText(
        /2 tasks, comments, and activity will be permanently deleted/,
      ),
    ).toBeInTheDocument();
    const input = within(dialog).getByLabelText("Project name confirmation");
    const deleteButton = within(dialog).getByRole("button", {
      name: "Delete project",
    });
    expect(document.activeElement).toBe(input);
    expect(deleteButton).toBeDisabled();

    fireEvent.change(input, { target: { value: "roadmap" } });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(input, { target: { value: "Roadmap " } });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(input, { target: { value: "Roadmap" } });
    expect(deleteButton).toBeEnabled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("deletes successfully, invalidates related queries, clears project caches, and redirects", async () => {
    mockApi("ADMIN");
    const queryClient = createQueryClient();
    queryClient.setQueryData(["project", "1"], project);
    queryClient.setQueryData(["tasks", "1", {}], {
      results: [{ id: 9, project: 1 }],
    });
    queryClient.setQueryData(["task", "9"], { id: 9, project: 1 });
    queryClient.setQueryData(["comments", "9"], []);
    queryClient.setQueryData(["task-activity", "9"], []);
    queryClient.setQueryData(["project-task-summary", 2, 1], { count: 2 });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    renderWithClient(<Dashboard />, queryClient);

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete project Roadmap" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete project?",
    });
    fireEvent.change(
      within(dialog).getByLabelText("Project name confirmation"),
      {
        target: { value: "Roadmap" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete project" }),
    );

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"));
    expect(mocks.api).toHaveBeenCalledWith("/api/projects/1/", {
      method: "DELETE",
    });
    const invalidatedKeys = invalidateQueries.mock.calls.map(
      ([filters]) => filters?.queryKey,
    );
    for (const key of [["projects"], ["stats"], ["activity"], ["tasks"]]) {
      expect(invalidatedKeys).toContainEqual(key);
    }
    for (const key of [
      ["project", "1"],
      ["tasks", "1", {}],
      ["task", "9"],
      ["comments", "9"],
      ["task-activity", "9"],
      ["project-task-summary", 2, 1],
    ]) {
      expect(queryClient.getQueryData(key)).toBeUndefined();
    }
    expect(await screen.findByText("Project deleted.")).toBeInTheDocument();
  });

  it("keeps the dialog open and displays an API failure", async () => {
    mockApi("OWNER", () => {
      throw new Error("Project deletion failed.");
    });
    renderWithClient(<Dashboard />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Delete project Roadmap" }),
    );
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete project?",
    });
    fireEvent.change(
      within(dialog).getByLabelText("Project name confirmation"),
      {
        target: { value: "Roadmap" },
      },
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete project" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Project deletion failed.",
    );
    expect(
      screen.getByRole("alertdialog", { name: "Delete project?" }),
    ).toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
