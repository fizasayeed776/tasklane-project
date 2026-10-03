"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { refreshSession } from "@/lib/api";
import { relativeTime } from "@/lib/format";

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
  const [session, setSession] = useState<Session>({
    access: "",
    organization: "",
  });
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
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
    setReadIds(new Set());
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
            setNotifications((current) =>
              [notification, ...current].slice(0, 20),
            );
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

  const unreadCount = notifications.filter(
    (notification) => !readIds.has(notification.id),
  ).length;

  return (
    <div className="relative flex items-center">
      {session.organization && (
        <button
          type="button"
          className="relative grid size-10 place-items-center rounded-md text-sm hover:bg-accent-soft"
          aria-expanded={open}
          aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ""}${connectionError ? " disconnected" : ""}`}
          onClick={() => setOpen((value) => !value)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
            <path d="M10 21h4" />
          </svg>
          {notifications.length > 0 && (
            <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {notifications.length > 9 ? "9+" : notifications.length}
            </span>
          )}
        </button>
      )}
      {open && (
        <section className="absolute right-0 top-12 z-40 max-h-96 w-80 overflow-y-auto rounded-lg border border-line bg-surface p-3 shadow-md">
          <h2 className="mb-2 font-semibold">Recent notifications</h2>
          {notifications.length === 0 ? (
            <p className="py-4 text-sm text-muted">
              You’re all caught up. New activity will appear here.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={`flex items-start gap-2 rounded-md border-b border-line p-2 last:border-0 ${readIds.has(notification.id) ? "" : "bg-accent-soft/50"}`}
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      className="underline underline-offset-2"
                      href={`/tasks/${notification.task_id}`}
                      onClick={() => {
                        setReadIds((current) =>
                          new Set(current).add(notification.id),
                        );
                        setOpen(false);
                      }}
                    >
                      {notification.message}
                    </Link>
                    <time
                      className="mt-1 block text-xs text-muted"
                      dateTime={notification.created_at}
                    >
                      {relativeTime(notification.created_at)}
                    </time>
                  </div>
                  {!readIds.has(notification.id) && (
                    <button
                      type="button"
                      className="min-h-9 shrink-0 rounded-md px-2 text-xs underline underline-offset-2"
                      aria-label={`Mark notification as read: ${notification.message}`}
                      onClick={() =>
                        setReadIds((current) =>
                          new Set(current).add(notification.id),
                        )
                      }
                    >
                      Mark read
                    </button>
                  )}
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
    </div>
  );
}
