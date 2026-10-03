import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, api: mocks.api };
});

import SettingsPage from "./(app)/settings/SettingsClient";
import { ToastProvider } from "./components/ToastProvider";

function renderSettingsPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

describe("account settings", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    // Default: /api/organizations/ returns empty list so the danger zone is hidden
    // and mutation tests can override with mockImplementation or mockResolvedValue.
    mocks.api.mockImplementation(async (endpoint: string) => {
      if (endpoint === "/api/organizations/") return [];
      throw new Error(`Unexpected API call in settings test: ${endpoint}`);
    });
  });

  it("renders the password and email forms", () => {
    renderSettingsPage();

    expect(
      screen.getByRole("heading", { name: "Change password" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Change email" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("New email")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm new password")).toBeInTheDocument();
  });

  it("stores the returned session after a successful password change", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/") return [];
        if (
          endpoint === "/api/auth/password/change/" &&
          init?.method === "POST"
        )
          return {
            success: true,
            access: "new-access",
            refresh: "new-refresh",
          };
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderSettingsPage();

    fireEvent.change(screen.getAllByLabelText("Current password")[0], {
      target: { value: "StrongPass!234" },
    });
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "NewStrong!567" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "NewStrong!567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/auth/password/change/", {
        method: "POST",
        json: {
          old_password: "StrongPass!234",
          new_password: "NewStrong!567",
        },
      });
      expect(localStorage.getItem("access")).toBe("new-access");
      expect(localStorage.getItem("refresh")).toBe("new-refresh");
      expect(screen.getByRole("status")).toHaveTextContent(
        "Your password has been changed.",
      );
    });
  });

  it("shows a server error after a failed email change", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/") return [];
        if (endpoint === "/api/auth/email/change/" && init?.method === "POST")
          throw new Error("A user with this email already exists.");
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    renderSettingsPage();

    fireEvent.change(screen.getByLabelText("New email"), {
      target: { value: "used@example.com" },
    });
    fireEvent.change(screen.getAllByLabelText("Current password")[1], {
      target: { value: "StrongPass!234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "A user with this email already exists.",
      );
    });
  });

  it("refreshes the cached current-user query after a successful email change", async () => {
    mocks.api.mockImplementation(
      async (endpoint: string, init?: RequestInit & { json?: unknown }) => {
        if (endpoint === "/api/organizations/") return [];
        if (endpoint === "/api/auth/email/change/" && init?.method === "POST")
          return { success: true };
        throw new Error(`Unexpected API call: ${endpoint}`);
      },
    );
    const { client } = renderSettingsPage();
    client.setQueryData(["me"], { email: "old@example.com" });

    fireEvent.change(screen.getByLabelText("New email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getAllByLabelText("Current password")[1], {
      target: { value: "StrongPass!234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Change email" }));

    await waitFor(() => {
      expect(mocks.api).toHaveBeenCalledWith("/api/auth/email/change/", {
        method: "POST",
        json: {
          new_email: "new@example.com",
          current_password: "StrongPass!234",
        },
      });
      expect(client.getQueryState(["me"])?.isInvalidated).toBe(true);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Your email address has been changed.",
      );
    });
  });
});
