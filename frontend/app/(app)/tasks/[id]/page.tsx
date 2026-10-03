"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  api,
  canManage,
  canWrite,
  errorMessage,
  Org,
  OrgMember,
  STATUSES,
  Status,
  Task,
} from "@/lib/api";
import { initials, relativeTime, roleLabel } from "@/lib/format";
import QueryError from "../../../components/QueryError";
import { useToast } from "../../../components/ToastProvider";

type TaskComment = {
  id: number;
  user: number;
  user_name: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type TaskActivity = {
  id: number;
  verb: string;
  message: string;
  created_at: string;
};

type TaskUpdate = Partial<
  Pick<
    Task,
    "title" | "description" | "priority" | "status" | "assigned_to" | "due_date"
  >
>;

function statusLabel(status: string) {
  return status === "TODO"
    ? "To do"
    : status
        .toLowerCase()
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activityGlyph(verb: string) {
  if (verb.includes("assigned")) return "↗";
  if (verb.includes("status")) return "↻";
  if (verb.includes("comment")) return "“";
  return "＋";
}

function formattedDate(value?: string | null) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [editingComment, setEditingComment] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const task = useQuery<Task>({
    queryKey: ["task", id],
    queryFn: () => api(`/api/tasks/${id}/`),
  });
  const orgs = useQuery<Org[]>({
    queryKey: ["orgs"],
    queryFn: () => api("/api/organizations/"),
  });
  const me = useQuery<{ id: number; display_name?: string }>({
    queryKey: ["me"],
    queryFn: () => api("/api/auth/me/"),
  });
  const comments = useQuery<TaskComment[]>({
    queryKey: ["comments", id],
    queryFn: () => api(`/api/tasks/${id}/comments/`),
  });
  const activity = useQuery<TaskActivity[]>({
    queryKey: ["task-activity", id],
    queryFn: () => api(`/api/tasks/${id}/activity/`),
  });
  const orgRole = orgs.data?.find(
    (organization) => organization.id === task.data?.organization,
  )?.role;
  const canEditTask =
    canManage(orgRole) ||
    (canWrite(orgRole) &&
      (task.data?.created_by === me.data?.id ||
        task.data?.assigned_to === me.data?.id));
  const members = useQuery<OrgMember[]>({
    queryKey: ["members", task.data?.organization],
    queryFn: () =>
      api(`/api/organizations/${task.data?.organization}/members/`),
    enabled: !!task.data?.organization && canWrite(orgRole),
  });
  useEffect(() => {
    if (task.data) {
      setTitleDraft(task.data.title);
      setDescriptionDraft(task.data.description);
    }
  }, [task.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["comments", id] });
    qc.invalidateQueries({ queryKey: ["task-activity", id] });
  };
  const add = useMutation({
    mutationFn: () =>
      api(`/api/tasks/${id}/comments/`, {
        method: "POST",
        json: { content: text.trim() },
      }),
    onSuccess: () => {
      setText("");
      refresh();
      toast("success", "Comment added.");
    },
    onError: (error) => toast("error", errorMessage(error)),
  });
  const updateComment = useMutation({
    mutationFn: ({
      commentId,
      content,
    }: {
      commentId: number;
      content: string;
    }) =>
      api(`/api/comments/${commentId}/`, {
        method: "PATCH",
        json: { content },
      }),
    onSuccess: () => {
      setEditingComment(null);
      setCommentDraft("");
      refresh();
      toast("success", "Comment updated.");
    },
    onError: (error) => toast("error", errorMessage(error)),
  });
  const del = useMutation({
    mutationFn: (commentId: number) =>
      api(`/api/comments/${commentId}/`, { method: "DELETE" }),
    onSuccess: () => {
      refresh();
      toast("success", "Comment deleted.");
    },
    onError: (error) => toast("error", errorMessage(error)),
  });
  const updateTask = useMutation({
    mutationFn: (changes: TaskUpdate) =>
      api(`/api/tasks/${id}/`, { method: "PATCH", json: changes }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["task", id] });
      await qc.invalidateQueries({
        queryKey: ["tasks", String(task.data?.project)],
      });
      setTitleEditing(false);
      toast("success", "Task updated.");
    },
    onError: (error) => toast("error", errorMessage(error)),
  });

  const queryError =
    task.error ??
    orgs.error ??
    me.error ??
    comments.error ??
    activity.error ??
    members.error;
  if (queryError) {
    return (
      <main className="px-4 py-8 sm:px-6">
        <QueryError
          error={queryError}
          resource="task"
          onRetry={() => void qc.invalidateQueries()}
        />
      </main>
    );
  }
  const currentTask = task.data;
  const commentsList = comments.data ?? [];
  const activityList = activity.data ?? [];
  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      {currentTask && (
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <ol className="flex items-center gap-2">
            <li>
              <Link href="/dashboard" className="hover:text-ink">
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link
                href={`/projects/${currentTask.project}`}
                className="hover:text-ink"
              >
                Project
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="truncate text-ink">
              {currentTask.title}
            </li>
          </ol>
        </nav>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-5">
          <section className="panel space-y-4">
            {titleEditing && canEditTask ? (
              <form
                className="space-y-4"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  updateTask.mutate({
                    title: titleDraft.trim(),
                    description: descriptionDraft,
                  });
                }}
              >
                <label className="block space-y-1 text-sm">
                  <span>Task title</span>
                  <input
                    autoFocus
                    className="input w-full text-lg"
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    required
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  <span>Description</span>
                  <textarea
                    className="input w-full"
                    rows={5}
                    value={descriptionDraft}
                    onChange={(event) =>
                      setDescriptionDraft(event.target.value)
                    }
                  />
                </label>
                {updateTask.isError && (
                  <p role="alert" className="text-sm text-danger">
                    {errorMessage(updateTask.error)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button className="btn" disabled={updateTask.isPending}>
                    {updateTask.isPending ? "Saving…" : "Save task"}
                  </button>
                  <button
                    className="min-h-10 rounded-md border border-line px-4"
                    type="button"
                    onClick={() => {
                      setTitleDraft(currentTask?.title ?? "");
                      setDescriptionDraft(currentTask?.description ?? "");
                      setTitleEditing(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <header className="flex flex-wrap items-start gap-3">
                  <h1 className="page-title min-w-0 flex-1 text-[28px] font-semibold">
                    {currentTask?.title}
                  </h1>
                  {canEditTask && (
                    <button
                      className="min-h-10 shrink-0 rounded-md border border-line px-3 text-sm"
                      type="button"
                      onClick={() => setTitleEditing(true)}
                    >
                      Edit task
                    </button>
                  )}
                </header>
                <div className="whitespace-pre-wrap text-sm leading-6">
                  {currentTask?.description || (
                    <span className="text-muted">No description yet.</span>
                  )}
                </div>
              </>
            )}
          </section>

          <section className="panel space-y-4">
            <div>
              <h2 className="font-semibold">Comments</h2>
              <p className="mt-1 text-sm text-muted">
                Keep decisions and context close to the work.
              </p>
            </div>
            <ul className="divide-y divide-line">
              {commentsList.map((comment) => {
                const isOwnComment = comment.user === me.data?.id;
                const canDeleteComment =
                  canWrite(orgRole) && (isOwnComment || canManage(orgRole));
                return (
                  <li key={comment.id} className="flex gap-3 py-4">
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
                    >
                      {initials(comment.user_name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-medium">{comment.user_name}</span>
                        <time
                          className="text-xs text-muted"
                          dateTime={comment.created_at}
                        >
                          {relativeTime(comment.created_at)}
                        </time>
                        {comment.updated_at !== comment.created_at && (
                          <span className="text-xs text-muted">(edited)</span>
                        )}
                      </div>
                      {editingComment === comment.id ? (
                        <form
                          className="mt-2 space-y-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            updateComment.mutate({
                              commentId: comment.id,
                              content: commentDraft.trim(),
                            });
                          }}
                        >
                          <label className="block">
                            <span className="sr-only">Edit comment</span>
                            <textarea
                              autoFocus
                              className="input w-full"
                              rows={3}
                              value={commentDraft}
                              onChange={(event) =>
                                setCommentDraft(event.target.value)
                              }
                            />
                          </label>
                          <div className="flex gap-2">
                            <button
                              className="btn"
                              disabled={
                                !commentDraft.trim() || updateComment.isPending
                              }
                            >
                              {updateComment.isPending
                                ? "Saving…"
                                : "Save comment"}
                            </button>
                            <button
                              className="min-h-10 rounded-md border border-line px-3"
                              type="button"
                              onClick={() => setEditingComment(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6">
                          {comment.content}
                        </p>
                      )}
                      {canDeleteComment && editingComment !== comment.id && (
                        <div className="mt-2 flex gap-3 text-xs">
                          {isOwnComment && (
                            <button
                              className="min-h-10 underline underline-offset-2"
                              type="button"
                              onClick={() => {
                                setEditingComment(comment.id);
                                setCommentDraft(comment.content);
                              }}
                            >
                              Edit
                            </button>
                          )}
                          <button
                            className="min-h-10 underline underline-offset-2"
                            type="button"
                            disabled={del.isPending}
                            onClick={() => del.mutate(comment.id)}
                          >
                            {del.isPending ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
              {commentsList.length === 0 && (
                <li className="py-6 text-sm text-muted">
                  No comments yet. Add the first note when you are ready.
                </li>
              )}
            </ul>
            {canWrite(orgRole) && (
              <form
                className="space-y-3 border-t border-line pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  add.mutate();
                }}
              >
                <label className="block space-y-1 text-sm">
                  <span>Add a comment</span>
                  <textarea
                    className="input w-full"
                    placeholder="Write a comment"
                    rows={4}
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                  />
                </label>
                {add.isError && (
                  <p role="alert" className="text-sm text-danger">
                    {errorMessage(add.error)}
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    className="btn"
                    disabled={!text.trim() || add.isPending}
                  >
                    {add.isPending ? "Posting…" : "Comment"}
                  </button>
                </div>
              </form>
            )}
            {(del.isError || updateComment.isError) && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(del.error || updateComment.error)}
              </p>
            )}
          </section>

          <details className="panel group">
            <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              Activity history
              <span
                aria-hidden="true"
                className="text-sm text-muted transition-transform group-open:rotate-180"
              >
                ⌄
              </span>
            </summary>
            <ul className="mt-4 space-y-4 border-t border-line pt-4">
              {activityList.map((item) => (
                <li key={item.id} className="flex gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"
                  >
                    {activityGlyph(item.verb)}
                  </span>
                  <div>
                    <p>{item.message}</p>
                    <time
                      className="mt-1 block text-xs text-muted"
                      dateTime={item.created_at}
                    >
                      {relativeTime(item.created_at)}
                    </time>
                  </div>
                </li>
              ))}
              {activityList.length === 0 && (
                <li className="text-sm text-muted">
                  No activity has been recorded yet.
                </li>
              )}
            </ul>
          </details>
        </div>

        <aside className="panel space-y-4 lg:sticky lg:top-20">
          <h2 className="font-semibold">Task details</h2>
          {updateTask.isError && !titleEditing && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(updateTask.error)}
            </p>
          )}
          <dl className="space-y-4 text-sm">
            <div className="space-y-1">
              <dt className="text-xs text-muted">Status</dt>
              <dd>
                {canEditTask ? (
                  <select
                    className="input w-full"
                    aria-label="Status"
                    value={currentTask?.status ?? "TODO"}
                    disabled={updateTask.isPending}
                    onChange={(event) =>
                      updateTask.mutate({
                        status: event.target.value as Status,
                      })
                    }
                  >
                    {STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="inline-flex min-h-10 items-center rounded-full bg-accent-soft px-3">
                    {currentTask ? statusLabel(currentTask.status) : "—"}
                  </span>
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted">Priority</dt>
              <dd>
                {canEditTask ? (
                  <select
                    className="input w-full"
                    aria-label="Priority"
                    value={currentTask?.priority ?? "MEDIUM"}
                    disabled={updateTask.isPending}
                    onChange={(event) =>
                      updateTask.mutate({ priority: event.target.value })
                    }
                  >
                    {["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => (
                      <option key={priority} value={priority}>
                        {roleLabel(priority)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>
                    {currentTask ? roleLabel(currentTask.priority) : "—"}
                  </span>
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted">Assignee</dt>
              <dd>
                {canEditTask ? (
                  <select
                    className="input w-full"
                    aria-label="Assignee"
                    value={currentTask?.assigned_to ?? ""}
                    disabled={updateTask.isPending}
                    onChange={(event) =>
                      updateTask.mutate({
                        assigned_to: event.target.value
                          ? Number(event.target.value)
                          : null,
                      })
                    }
                  >
                    <option value="">Unassigned</option>
                    {members.data?.map((member) => (
                      <option key={member.user_id} value={member.user_id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{currentTask?.assigned_to_name ?? "Unassigned"}</span>
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted">Due date</dt>
              <dd>
                {canEditTask ? (
                  <input
                    aria-label="Due date"
                    className="input w-full"
                    type="date"
                    value={currentTask?.due_date ?? ""}
                    disabled={updateTask.isPending}
                    onChange={(event) =>
                      updateTask.mutate({
                        due_date: event.target.value || null,
                      })
                    }
                  />
                ) : (
                  <span>{formattedDate(currentTask?.due_date)}</span>
                )}
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted">Created by</dt>
              <dd>{currentTask?.created_by_name ?? "—"}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-xs text-muted">Created</dt>
              <dd>
                {currentTask?.created_at ? (
                  <time dateTime={currentTask.created_at}>
                    {formattedDate(currentTask.created_at)}
                  </time>
                ) : (
                  "—"
                )}
              </dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
