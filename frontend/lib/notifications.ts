export type Notification = {
  id: number;
  event_type: string;
  message: string;
  organization: { id: number; name: string };
  task: number | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
};

export type NotificationPage = {
  count: number;
  next: string | null;
  previous: string | null;
  results: Notification[];
};

export const notificationQueryKeys = {
  all: ["notifications"] as const,
  lists: () => ["notifications", "list"] as const,
  list: (unread: boolean) => ["notifications", "list", { unread }] as const,
  unreadCount: () => ["notifications", "unread-count"] as const,
};
