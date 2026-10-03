import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import QueryError from "./components/QueryError";

describe("query error actions", () => {
  it.each([403, 404])(
    "shows an unavailable title and dashboard link for HTTP %s",
    (status) => {
      render(
        <QueryError
          error={new ApiError("UNAVAILABLE", "Not available", status)}
          onRetry={vi.fn()}
          resource="project"
        />,
      );

      expect(
        screen.getByRole("heading", { name: "Project is unavailable" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Back to dashboard" }),
      ).toHaveAttribute("href", "/dashboard");
      expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    },
  );

  it("keeps retry for server errors", () => {
    const onRetry = vi.fn();
    render(
      <QueryError
        error={new ApiError("SERVER_ERROR", "Service unavailable", 503)}
        onRetry={onRetry}
        resource="project"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("link", { name: "Back to dashboard" }),
    ).toBeNull();
  });

  it("keeps retry for network errors", () => {
    const onRetry = vi.fn();
    render(
      <QueryError
        error={new TypeError("Failed to fetch")}
        onRetry={onRetry}
        resource="project"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
