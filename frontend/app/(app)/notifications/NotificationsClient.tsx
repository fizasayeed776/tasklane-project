"use client";

import {
  InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api, errorMessage, setOrganization } from "@/lib/api";
import {
  notificationQueryKeys,
  type Notification,
  type NotificationPage,
} from "@/lib/notifications";
import { relativeTime } from "@/lib/format";
import QueryError from "../../components/QueryError";
import { useToast } from "../../components/ToastProvider";
import NotificationsLoading from "./loading";

type CachedPage = InfiniteData<NotificationPage, number>;
type CacheSnapshot = {
  lists: [readonly unknown[], CachedPage | undefined][];
  unreadCount: { count: number } | undefined;
};

function eventLabel(eventType: string) {
  return eventType
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function NotificationsClient() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const unreadCount = useQuery({
    queryKey: notificationQueryKeys.unreadCount(),
    queryFn: () => api<{ count: number }>("/api/notifications/unread-count/"),
  });
  const notifications = useInfiniteQuery({
    queryKey: notificationQueryKeys.list(unreadOnly),
    queryFn: ({ pageParam }) =>
      api<NotificationPage>(
        `/api/notifications/?${unreadOnly ? "unread=true&" : ""}page=${pageParam}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage, _allPages, lastPageParam) =>
      lastPage.next ? lastPageParam + 1 : undefined,
  });

  function snapshotCaches(): CacheSnapshot {
    return {
      lists: queryClient.getQueriesData<CachedPage>({
        queryKey: notificationQueryKeys.lists(),
      }),
      unreadCount: queryClient.getQueryData(
        notificationQueryKeys.unreadCount(),
      ),
    };
  }

  function restoreCaches(snapshot?: CacheSnapshot) {
    if (!snapshot) return;
    snapshot.lists.forEach(([key, data]) => {
      queryClient.setQueryData(key, data);
    });
    queryClient.setQueryData(
      notificationQueryKeys.unreadCount(),
      snapshot.unreadCount,
    );
  }

  function invalidateNotificationCaches() {
    void queryClient.invalidateQueries({
      queryKey: notificationQueryKeys.all,
    });
  }

  const markRead = useMutation({
    mutationFn: (id: number) =>
      api(`/api/notifications/${id}/read/`, { method: "POST" }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: notificationQueryKeys.all,
      });
      const snapshot = snapshotCaches();
      const wasUnread = snapshot.lists.some(([, data]) =>
        data?.pages.some((page) =>
          page.results.some((item) => item.id === id && !item.read),
        ),
      );
      snapshot.lists.forEach(([key, data]) => {
        if (!data) return;
        const isUnreadList =
          Array.isArray(key) &&
          typeof key[2] === "object" &&
          key[2] !== null &&
          "unread" in key[2] &&
          key[2].unread === true;
        queryClient.setQueryData<CachedPage>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            results: page.results
              .map((item) =>
                item.id === id
                  ? { ...item, read: true, read_at: new Date().toISOString() }
                  : item,
              )
              .filter((item) => !(isUnreadList && item.id === id)),
          })),
        });
      });
      if (wasUnread) {
        queryClient.setQueryData<{ count: number }>(
          notificationQueryKeys.unreadCount(),
          (current) =>
            current ? { count: Math.max(0, current.count - 1) } : current,
        );
      }
      return snapshot;
    },
    onError: (error, _id, snapshot) => {
      restoreCaches(snapshot);
      toast("error", errorMessage(error));
    },
    onSettled: invalidateNotificationCaches,
  });

  const markAllRead = useMutation({
    mutationFn: () =>
      api("/api/notifications/mark-all-read/", { method: "POST" }),
    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: notificationQueryKeys.all,
      });
      const snapshot = snapshotCaches();
      const readAt = new Date().toISOString();
      snapshot.lists.forEach(([key, data]) => {
        if (!data) return;
        const isUnreadList =
          Array.isArray(key) &&
          typeof key[2] === "object" &&
          key[2] !== null &&
          "unread" in key[2] &&
          key[2].unread === true;
        queryClient.setQueryData<CachedPage>(key, {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            results: isUnreadList
              ? []
              : page.results.map((item) => ({
                  ...item,
                  read: true,
                  read_at: readAt,
                })),
          })),
        });
      });
      queryClient.setQueryData<{ count: number }>(
        notificationQueryKeys.unreadCount(),
        { count: 0 },
      );
      return snapshot;
    },
    onError: (error, _variables, snapshot) => {
      restoreCaches(snapshot);
      toast("error", errorMessage(error));
    },
    onSettled: invalidateNotificationCaches,
  });

  function openNotification(notification: Notification) {
    if (!notification.read) markRead.mutate(notification.id);
    if (notification.task === null) {
      toast("error", "This task no longer exists.");
      return;
    }
    if (localStorage.getItem("org") !== String(notification.organization.id)) {
      setOrganization(String(notification.organization.id));
    }
    router.push(`/tasks/${notification.task}`);
  }

  const items = notifications.data?.pages.flatMap((page) => page.results) ?? [];
  const unreadTotal = unreadCount.data?.count ?? 0;

  if (notifications.isPending) {
    return <NotificationsLoading />;
  }
  if (notifications.isError) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <QueryError
          error={notifications.error}
          onRetry={() => void notifications.refetch()}
          resource="notifications"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Notifications</h1>
        <button
          type="button"
          className="btn"
          disabled={unreadTotal === 0 || markAllRead.isPending}
          onClick={() => markAllRead.mutate()}
        >
          Mark all as read
        </button>
      </header>

      <div
        className="mt-6 flex gap-2 border-b border-line"
        role="tablist"
        aria-label="Notification filters"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!unreadOnly}
          className={`min-h-11 border-b-2 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
            unreadOnly
              ? "border-transparent text-muted"
              : "border-accent font-medium"
          }`}
          onClick={() => setUnreadOnly(false)}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={unreadOnly}
          className={`min-h-11 border-b-2 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
            unreadOnly
              ? "border-accent font-medium"
              : "border-transparent text-muted"
          }`}
          onClick={() => setUnreadOnly(true)}
        >
          Unread
        </button>
      </div>

      {items.length === 0 ? (
        <p className="panel mt-6 py-10 text-center text-muted">
          {unreadOnly ? "You're all caught up." : "No notifications yet."}
        </p>
      ) : (
        <ul
          className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface"
          aria-label="Notifications"
          aria-live="polite"
          aria-relevant="additions"
        >
          {items.map((notification) => (
            <li key={notification.id}>
              <button
                type="button"
                className={`flex min-h-20 w-full items-start gap-3 px-4 py-4 text-left hover:bg-accent-soft/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${
                  notification.read ? "" : "font-medium"
                }`}
                onClick={() => openNotification(notification)}
              >
                <span
                  className={`mt-2 size-2 shrink-0 rounded-full ${
                    notification.read ? "bg-transparent" : "bg-accent"
                  }`}
                  aria-label={notification.read ? undefined : "Unread"}
                />
                <span className="min-w-0 flex-1">
                  <span className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-accent-soft px-2 py-1 text-accent">
                      {eventLabel(notification.event_type)}
                    </span>
                    <span className="rounded-full border border-line px-2 py-1 text-muted">
                      {notification.organization.name}
                    </span>
                  </span>
                  <span className="block">{notification.message}</span>
                  <time
                    className="mt-1 block text-xs text-muted"
                    dateTime={notification.created_at}
                  >
                    {relativeTime(notification.created_at)}
                  </time>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {notifications.hasNextPage && (
        <div className="mt-6 text-center">
          <button
            type="button"
            className="btn"
            disabled={notifications.isFetchingNextPage}
            onClick={() => void notifications.fetchNextPage()}
          >
            {notifications.isFetchingNextPage ? "Loading..." : "Load more"}
          </button>
        </div>
      )}
    </main>
  );
}
