"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, refreshSession, setOrganization } from "@/lib/api";
import { notificationQueryKeys, type Notification } from "@/lib/notifications";
import { useToast } from "./ToastProvider";

type NotificationEvent = Pick<Notification, "id" | "message" | "created_at"> & {
  type: string;
  organization_id: number;
  task_id: number | null;
};

type Session = { access: string; organization: string };

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type UnreadCount = { count: number };

function readSession(): Session {
  return {
    access: localStorage.getItem("access") ?? "",
    organization: localStorage.getItem("org") ?? "",
  };
}

export default function NotificationsNavbar() {
  const push = useRouter().push;
  const queryClient = useQueryClient();
  const toast = useToast();
  const [session, setSession] = useState<Session>({
    access: "",
    organization: "",
  });
  const [connectionError, setConnectionError] = useState(false);
  const unreadCount = useQuery<UnreadCount>({
    queryKey: notificationQueryKeys.unreadCount(),
    queryFn: () => api("/api/notifications/unread-count/"),
    enabled: !!session.access,
  });

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
          const notification = JSON.parse(event.data) as NotificationEvent;
          if (
            notification.organization_id === Number(session.organization) &&
            notification.id &&
            notification.message
          ) {
            void queryClient.invalidateQueries({
              queryKey: notificationQueryKeys.all,
            });
            toast(
              "success",
              notification.message,
              notification.task_id
                ? {
                    label: "View",
                    onClick: () => {
                      if (
                        localStorage.getItem("org") !==
                        String(notification.organization_id)
                      ) {
                        setOrganization(String(notification.organization_id));
                      }
                      push(`/tasks/${notification.task_id}`);
                    },
                  }
                : undefined,
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
  }, [queryClient, push, session.access, session.organization, toast]);

  if (!session.access) return null;

  const count = unreadCount.data?.count ?? 0;
  const label = `Notifications${count ? ` (${count} unread)` : ""}${connectionError ? " disconnected" : ""}`;

  return (
    <div className="relative flex items-center">
      {session.organization && (
        <Link
          href="/notifications"
          className="relative grid size-10 place-items-center rounded-md text-sm hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          aria-label={label}
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
          {count > 0 && (
            <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Link>
      )}
    </div>
  );
}
