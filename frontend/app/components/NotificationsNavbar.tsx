"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { refreshSession } from "@/lib/api";

type Notification = {
  id: string;
  type: "task_assigned" | "comment_added" | "status_changed" | string;
  organization_id: number;
  task_id: number;
  message: string;
  created_at: string;
};

type Session = { access: string; organization: string };

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function readSession(): Session {
  return {
    access: localStorage.getItem("access") ?? "",
    organization: localStorage.getItem("org") ?? "",
  };
}

export default function NotificationsNavbar() {
  const [session, setSession] = useState<Session>({ access: "", organization: "" });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    const updateSession = () => setSession(readSession());
    updateSession();
    window.addEventListener("tasklane:session", updateSession);
    window.addEventListener("tasklane:organization", updateSession);
    window.addEventListener("storage", updateSession);
    return () => {
      window.removeEventListener("tasklane:session", updateSession);
      window.removeEventListener("tasklane:organization", updateSession);
      window.removeEventListener("storage", updateSession);
    };
  }, []);

  useEffect(() => {
    setNotifications([]);
    setConnectionError(false);
    if (!session.access || !session.organization) return;

    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    let retryCount = 0;
    const url = new URL("/ws/notifications/", API);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("organization_id", session.organization);

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(url, ["tasklane", `jwt.${session.access}`]);
      socket.onopen = () => {
        retryCount = 0;
        setConnectionError(false);
      };
      socket.onmessage = (event) => {
        try {
          const notification = JSON.parse(event.data) as Notification;
          if (
            notification.organization_id === Number(session.organization) &&
            notification.id &&
            notification.message
          ) {
            setNotifications((current) => [notification, ...current].slice(0, 20));
          }
        } catch (error) {
          console.error("Received an invalid Tasklane notification.", error);
        }
      };
      socket.onclose = (event) => {
        if (stopped || event.code === 1000) return;
        if (event.code === 4401) {
          void refreshSession().then((refreshed) => {
            if (!refreshed) setConnectionError(true);
          });
          return;
        }
        if (event.code === 4400 || event.code === 4403) {
          setConnectionError(true);
          return;
        }
        setConnectionError(true);
        const delay = Math.min(1000 * 2 ** retryCount, 30_000);
        retryCount += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close(1000, "Session changed");
    };
  }, [session.access, session.organization]);

  if (!session.access) return null;

  return (
    <nav className="flex items-center justify-end border-b border-line bg-white px-6 py-2">
      {session.organization && (
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-sm hover:bg-line/50"
          aria-expanded={open}
          aria-label={`Notifications${notifications.length ? ` (${notifications.length})` : ""}${connectionError ? " disconnected" : ""}`}
          onClick={() => setOpen((value) => !value)}
        >
          Notifications{notifications.length > 0 ? ` (${notifications.length})` : ""}
        </button>
      )}
      {open && (
        <section className="absolute right-4 top-12 z-10 max-h-96 w-80 overflow-y-auto rounded-lg border border-line bg-white p-3 shadow-lg">
          <h2 className="mb-2 font-semibold">Recent notifications</h2>
          {notifications.length === 0 ? (
            <p className="text-sm text-ink/70">No new notifications.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {notifications.map((notification) => (
                <li key={notification.id} className="border-b border-line pb-2 last:border-0">
                  <Link
                    className="underline"
                    href={`/tasks/${notification.task_id}`}
                    onClick={() => setOpen(false)}
                  >
                    {notification.message}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {connectionError && (
            <span role="status" className="ml-2 text-xs text-warn">
              Notifications disconnected
            </span>
          )}
        </section>
      )}
    </nav>
  );
}
