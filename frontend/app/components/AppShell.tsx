"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api, clearSession, Org, setOrganization } from "@/lib/api";
import NotificationsNavbar from "./NotificationsNavbar";

type CurrentUser = {
  email: string;
  first_name?: string;
  display_name?: string;
};

function roleLabel(role: Org["role"]) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-4 shrink-0 transition-transform duration-150 ${
        open ? "rotate-180" : ""
      }`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const orgs = useQuery<Org[]>({
    queryKey: ["orgs"],
    queryFn: () => api("/api/organizations/"),
  });
  const user = useQuery<CurrentUser>({
    queryKey: ["me"],
    queryFn: () => api("/api/auth/me/"),
  });
  const [organizationId, setOrganizationId] = useState("");
  const [organizationMenuOpen, setOrganizationMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<
    "notifications" | "user" | null
  >(null);
  const notificationsContainerRef = useRef<HTMLDivElement>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const userContainerRef = useRef<HTMLDivElement>(null);
  const userButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!openDropdown) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        !notificationsContainerRef.current?.contains(target) &&
        !userContainerRef.current?.contains(target)
      ) {
        setOpenDropdown(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpenDropdown(null);
      if (openDropdown === "notifications") {
        notificationsButtonRef.current?.focus();
      } else {
        userButtonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openDropdown]);

  useEffect(() => {
    const current = localStorage.getItem("org") ?? "";
    if (
      orgs.data?.some((organization) => String(organization.id) === current)
    ) {
      setOrganizationId(current);
    } else if (orgs.data?.[0]) {
      const next = String(orgs.data[0].id);
      setOrganization(next);
      setOrganizationId(next);
    }
  }, [orgs.data]);

  const currentOrg = orgs.data?.find(
    (organization) => String(organization.id) === organizationId,
  );
  const displayName =
    user.data?.display_name || user.data?.first_name || user.data?.email;

  function chooseOrganization(value: string) {
    setOrganization(value);
    setOrganizationId(value);
    void queryClient.invalidateQueries();
  }

  function logOut() {
    clearSession();
    router.push("/login");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-1.5 px-3 sm:gap-3 sm:px-6">
          <Link
            href="/dashboard"
            aria-label="Tasklane home"
            className="flex min-h-10 shrink-0 items-center gap-2"
          >
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-md bg-accent text-sm font-semibold text-white"
            >
              T
            </span>
            <span className="hidden text-base font-semibold tracking-tight sm:inline">
              Tasklane
            </span>
          </Link>
          <div className="relative ml-auto">
            <button
              type="button"
              className="flex min-h-10 items-center gap-2 rounded-md border border-line px-3 text-sm hover:bg-accent-soft"
              aria-label="Organization switcher"
              aria-expanded={organizationMenuOpen}
              aria-controls="organization-menu"
              onClick={() => setOrganizationMenuOpen((open) => !open)}
            >
              <span className="max-w-36 truncate">
                {currentOrg?.name ?? "Choose organization"}
              </span>
              {currentOrg && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-ink">
                  {roleLabel(currentOrg.role)}
                </span>
              )}
              <ChevronDown open={organizationMenuOpen} />
            </button>
            {organizationMenuOpen && (
              <div
                role="menu"
                id="organization-menu"
                aria-label="Organizations"
                className="absolute right-0 top-12 z-40 w-64 rounded-lg border border-line bg-surface p-2"
              >
                {orgs.data?.map((organization) => (
                  <button
                    key={organization.id}
                    type="button"
                    role="menuitem"
                    className="flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm hover:bg-accent-soft"
                    onClick={() => {
                      chooseOrganization(String(organization.id));
                      setOrganizationMenuOpen(false);
                    }}
                  >
                    <span className="truncate">{organization.name}</span>
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-xs">
                      {roleLabel(organization.role)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div ref={notificationsContainerRef}>
            <NotificationsNavbar
              open={openDropdown === "notifications"}
              onToggle={() =>
                setOpenDropdown((current) =>
                  current === "notifications" ? null : "notifications",
                )
              }
              onClose={() => setOpenDropdown(null)}
              buttonRef={notificationsButtonRef}
            />
          </div>
          <div ref={userContainerRef} className="relative">
            <button
              ref={userButtonRef}
              type="button"
              className="flex min-h-10 items-center gap-2 rounded-md px-3 text-sm hover:bg-accent-soft"
              aria-expanded={openDropdown === "user"}
              aria-controls="user-menu"
              aria-label="User menu"
              onClick={() =>
                setOpenDropdown((current) =>
                  current === "user" ? null : "user",
                )
              }
            >
              <span className="hidden sm:inline">
                {displayName ?? "Account"}
              </span>
              <span className="sm:hidden" aria-hidden="true">
                {displayName?.slice(0, 1).toUpperCase() ?? "A"}
              </span>
              <ChevronDown open={openDropdown === "user"} />
            </button>
            {openDropdown === "user" && (
              <div
                id="user-menu"
                className="absolute right-0 top-12 z-40 w-60 rounded-lg border border-line bg-surface p-3"
              >
                <p className="truncate text-sm font-medium">
                  {displayName ?? "Account"}
                </p>
                <p className="truncate text-xs text-muted">
                  {user.data?.email}
                </p>
                <button
                  type="button"
                  className="mt-3 min-h-10 w-full rounded-md border border-line px-3 text-left text-sm hover:bg-accent-soft"
                  onClick={logOut}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
