"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  api,
  canManage,
  canWrite,
  errorMessage,
  Org,
  OrgMember,
  Project,
  Status,
  STATUSES,
  Task,
} from "@/lib/api";
import { initials, relativeTime, roleLabel } from "@/lib/format";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const PRIORITY_COLORS: Record<string, string> = {
  LOW: "bg-muted",
  MEDIUM: "bg-blue-600",
  HIGH: "bg-amber-600",
  URGENT: "bg-danger",
};
const STATUS_LABELS: Record<Status, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  REVIEW: "Review",
  DONE: "Done",
};

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] =
    useState<(typeof PRIORITIES)[number]>("MEDIUM");
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [createOpen, setCreateOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [archivePrompt, setArchivePrompt] = useState(false);
  const [dropTarget, setDropTarget] = useState<Status | null>(null);
  const [moveNotice, setMoveNotice] = useState(false);
  const taskFilters = useMemo(
    () => ({ search, priority: priorityFilter, assigned_to: assigneeFilter }),
    [search, priorityFilter, assigneeFilter],
  );
  const tasksKey = ["tasks", id, taskFilters];
  const project = useQuery<Project>({
    queryKey: ["project", id],
    queryFn: () => api(`/api/projects/${id}/`),
  });
  const orgId = project.data?.organization;
  const orgs = useQuery<Org[]>({
    queryKey: ["orgs"],
    queryFn: () => api("/api/organizations/"),
  });
  const members = useQuery<OrgMember[]>({
    queryKey: ["members", orgId],
    queryFn: () => api(`/api/organizations/${orgId}/members/`),
    enabled: !!orgId,
  });
  const tasks = useQuery<{ results: Task[] }>({
    queryKey: tasksKey,
    queryFn: () => {
      const params = new URLSearchParams({ project: id });
      if (search) params.set("search", search);
      if (priorityFilter) params.set("priority", priorityFilter);
      if (assigneeFilter) params.set("assigned_to", assigneeFilter);
      return api(`/api/tasks/?${params.toString()}`);
    },
  });
  const role = orgs.data?.find((o) => o.id === orgId)?.role;
  const writable = canWrite(role);
  const manageable = canManage(role);
  useEffect(() => {
    if (project.data)
      setDraft({
        name: project.data.name,
        description: project.data.description,
      });
  }, [project.data]);

  const create = useMutation({
    mutationFn: () =>
      api("/api/tasks/", {
        method: "POST",
        json: {
          project: Number(id),
          title,
          description,
          priority,
          assigned_to: assignee ? Number(assignee) : null,
          due_date: dueDate || null,
        },
      }),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
      qc.invalidateQueries({ queryKey: ["tasks", id] });
      setAssignee("");
      setDueDate("");
      setCreateOpen(false);
    },
  });
  const move = useMutation({
    mutationFn: ({ task, status }: { task: Task; status: Status }) =>
      api(`/api/tasks/${task.id}/`, { method: "PATCH", json: { status } }),
    onMutate: async ({ task, status }) => {
      // optimistic update
      await qc.cancelQueries({ queryKey: tasksKey });
      const prev = qc.getQueryData<{ results: Task[] }>(tasksKey);
      qc.setQueryData<{ results: Task[] }>(tasksKey, (current) =>
        current
          ? {
              ...current,
              results: current.results.map((item) =>
                item.id === task.id ? { ...item, status } : item,
              ),
            }
          : current,
      );
      return { prev };
    },
    onError: (_error, _variables, context) => {
      qc.setQueryData(tasksKey, context?.prev);
      setMoveNotice(true);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks", id] }),
  });
  const remove = useMutation({
    mutationFn: (t: Task) => api(`/api/tasks/${t.id}/`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks", id] }),
  });
  const updateProject = useMutation({
    mutationFn: () =>
      api(`/api/projects/${id}/`, { method: "PATCH", json: draft }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["project", id] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      setEditing(false);
    },
  });
  const archiveProject = useMutation({
    mutationFn: (status: Project["status"]) =>
      api(`/api/projects/${id}/`, { method: "PATCH", json: { status } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["project", id] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
  const list = tasks.data?.results ?? [];
  useEffect(() => {
    if (!createOpen && !actionsOpen && !deleteTarget && !archivePrompt) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCreateOpen(false);
      setActionsOpen(false);
      setDeleteTarget(null);
      setArchivePrompt(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [createOpen, actionsOpen, deleteTarget, archivePrompt]);
  useEffect(() => {
    if (!moveNotice) return;
    const timeout = window.setTimeout(() => setMoveNotice(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [moveNotice]);
  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <ol className="flex items-center gap-2">
          <li>
            <Link href="/dashboard" className="hover:text-ink">
              Dashboard
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="truncate text-ink">
            {project.data?.name ?? "Project"}
          </li>
        </ol>
      </nav>
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="page-title text-2xl font-semibold">
              {project.data?.name}
            </h1>
            {project.data?.status && (
              <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-ink">
                {project.data.status === "ACTIVE" ? "Active" : "Archived"}
              </span>
            )}
            {role && (
              <span className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted">
                {roleLabel(role)}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-muted">
            {project.data?.description && (
              <>
                {project.data.description}
                <span aria-hidden="true"> · </span>
              </>
            )}
            {list.length} tasks ·{" "}
            {list.filter((task) => task.status === "DONE").length} done ·{" "}
            {members.data?.length ?? 0} members
          </p>
        </div>
        {manageable && project.data && (
          <div className="relative">
            <button
              type="button"
              className="btn shrink-0 whitespace-nowrap"
              aria-expanded={actionsOpen}
              aria-controls="project-actions-menu"
              onClick={() => setActionsOpen((open) => !open)}
            >
              Project actions
            </button>
            {actionsOpen && (
              <div
                id="project-actions-menu"
                className="absolute right-0 top-full z-20 mt-2 min-w-40 rounded-lg border border-line bg-surface p-1"
              >
                {!editing && (
                  <button
                    className="min-h-10 w-full rounded-md px-3 text-left text-sm hover:bg-accent-soft"
                    onClick={() => {
                      setEditing(true);
                      setActionsOpen(false);
                    }}
                  >
                    Edit project
                  </button>
                )}
                <button
                  className="min-h-10 w-full rounded-md px-3 text-left text-sm hover:bg-accent-soft"
                  onClick={() => {
                    setArchivePrompt(true);
                    setActionsOpen(false);
                  }}
                >
                  {project.data.status === "ARCHIVED"
                    ? "Restore project"
                    : "Archive project"}
                </button>
              </div>
            )}
          </div>
        )}
      </header>
      {editing && manageable && (
        <form
          className="panel space-y-3"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            updateProject.mutate();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>Project name</span>
            <input
              className="input"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              required
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Description</span>
            <textarea
              className="input"
              rows={3}
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
          {updateProject.isError && (
            <p role="alert" className="text-sm text-warn">
              {errorMessage(updateProject.error)}
            </p>
          )}
          <div className="flex gap-2">
            <button className="btn" disabled={updateProject.isPending}>
              {updateProject.isPending ? "Saving…" : "Save project"}
            </button>
            <button
              className="rounded-md border border-line px-3 py-1.5 text-sm"
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {archiveProject.isError && (
        <p role="alert" className="text-sm text-warn">
          {errorMessage(archiveProject.error)}
        </p>
      )}
      <section className="panel space-y-3">
        <div>
          <h2 className="font-semibold">
            Organization members ({members.data?.length ?? 0})
          </h2>
          <p className="mt-1 text-sm text-muted">
            Members of the organization this project belongs to.
          </p>
        </div>
        <ul className="flex flex-wrap gap-2 text-sm">
          {members.data?.map((member) => (
            <li
              key={member.id}
              className="flex min-h-10 items-center gap-2 rounded-md border border-line px-2 py-1"
            >
              <span
                aria-hidden="true"
                className="grid size-7 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent"
              >
                {initials(member.name)}
              </span>
              <span className="font-medium">{member.name}</span>
              <span className="text-muted">{member.email}</span>
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-ink">
                {roleLabel(member.role)}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section
        aria-label="Task toolbar"
        className="flex flex-wrap items-center gap-2"
      >
        <label className="min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search tasks</span>
          <input
            className="input w-full"
            placeholder="Search tasks"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filter by priority</span>
          <select
            aria-label="Filter by priority"
            className="input w-auto"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="">All priorities</option>
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by assignee</span>
          <select
            aria-label="Filter by assignee"
            className="input w-auto max-w-44"
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
          >
            <option value="">All assignees</option>
            {members.data?.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        {writable && (
          <button
            type="button"
            className="btn ml-auto shrink-0 whitespace-nowrap"
            onClick={() => setCreateOpen(true)}
          >
            New task
          </button>
        )}
      </section>
      {remove.isError && (
        <p role="alert" className="text-sm text-warn">
          {errorMessage(remove.error)}
        </p>
      )}
      <div
        aria-label="Kanban board"
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 md:grid md:grid-cols-4 md:overflow-visible"
      >
        {STATUSES.map((col) => (
          <section
            key={col}
            className={`w-[82vw] max-w-sm shrink-0 snap-center rounded-xl border p-2 transition-colors md:w-auto md:max-w-none ${dropTarget === col ? "border-accent bg-accent-soft" : "border-line bg-line/25"}`}
            aria-label={`${STATUS_LABELS[col]} tasks`}
            onDragOver={(e) => e.preventDefault()}
            onDragEnter={() => setDropTarget(col)}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setDropTarget(null);
              }
            }}
            onDrop={(e) => {
              const t = list.find(
                (x) => x.id === Number(e.dataTransfer.getData("id")),
              );
              if (t && t.status !== col && writable)
                move.mutate({ task: t, status: col });
              setDropTarget(null);
            }}
          >
            <h2 className="sticky top-16 z-10 mb-2 flex items-center justify-between rounded-lg bg-surface px-2 py-2 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-accent"
                />
                {STATUS_LABELS[col]}
              </span>
              <span className="text-xs font-normal text-muted">
                {list.filter((task) => task.status === col).length}
              </span>
            </h2>
            <div className="min-h-24 space-y-2">
              {list
                .filter((task) => task.status === col)
                .map((task) => {
                  const overdue =
                    task.due_date &&
                    new Date(`${task.due_date}T23:59:59`).getTime() <
                      Date.now() &&
                    task.status !== "DONE";
                  return (
                    <article
                      key={task.id}
                      draggable={writable}
                      onDragStart={(e) =>
                        e.dataTransfer.setData("id", String(task.id))
                      }
                      className="group rounded-lg border border-line bg-surface p-3 transition-[box-shadow,transform] active:cursor-grabbing active:shadow-modal"
                    >
                      <Link
                        href={`/tasks/${task.id}`}
                        className="block rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        <span className="font-medium group-hover:text-accent">
                          {task.title}
                        </span>
                        {task.description && (
                          <span className="mt-1 block line-clamp-2 text-sm text-muted">
                            {task.description}
                          </span>
                        )}
                        <span className="mt-3 flex items-center gap-2 text-xs text-muted">
                          <span
                            aria-hidden="true"
                            className={`size-2 shrink-0 rounded-full ${PRIORITY_COLORS[task.priority] ?? "bg-muted"}`}
                          />
                          {roleLabel(task.priority)}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                          {task.assigned_to_name ? (
                            <>
                              <span
                                aria-hidden="true"
                                className="grid size-6 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent"
                              >
                                {initials(task.assigned_to_name)}
                              </span>
                              <span>{task.assigned_to_name}</span>
                            </>
                          ) : (
                            <span>Unassigned</span>
                          )}
                          {task.due_date && (
                            <time
                              className={overdue ? "text-danger" : ""}
                              dateTime={task.due_date}
                            >
                              Due{" "}
                              {new Intl.DateTimeFormat(undefined, {
                                month: "short",
                                day: "numeric",
                              }).format(new Date(`${task.due_date}T12:00:00`))}
                            </time>
                          )}
                          {typeof task.comment_count === "number" && (
                            <span>
                              {task.comment_count}{" "}
                              {task.comment_count === 1
                                ? "comment"
                                : "comments"}
                            </span>
                          )}
                        </span>
                      </Link>
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                        {writable && (
                          <label className="min-w-0 flex-1">
                            <span className="sr-only">
                              Move {task.title} to
                            </span>
                            <select
                              aria-label={`Move ${task.title} to`}
                              className="input min-h-9 w-full py-1 text-xs"
                              value={task.status}
                              onChange={(event) =>
                                move.mutate({
                                  task,
                                  status: event.target.value as Status,
                                })
                              }
                            >
                              {STATUSES.map((status) => (
                                <option key={status} value={status}>
                                  Move to {STATUS_LABELS[status]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {manageable && (
                          <button
                            className="min-h-9 rounded-md px-2 text-xs text-danger underline underline-offset-2"
                            type="button"
                            onClick={() => setDeleteTarget(task)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
      {moveNotice && (
        <p
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-line bg-surface px-4 py-3 text-sm"
        >
          Couldn’t move task. Reverted.
        </p>
      )}
      {createOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4">
          <section
            aria-labelledby="new-task-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl border border-line bg-surface p-6 shadow-modal"
            role="dialog"
          >
            <h2
              id="new-task-title"
              className="page-title text-xl font-semibold"
            >
              New task
            </h2>
            <form
              className="mt-4 grid gap-4 sm:grid-cols-2"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <label className="space-y-1 text-sm sm:col-span-2">
                <span>Title</span>
                <input
                  autoFocus
                  className="input w-full"
                  placeholder="Task title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span>Description</span>
                <textarea
                  className="input w-full"
                  rows={3}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Priority</span>
                <select
                  className="input w-full"
                  value={priority}
                  onChange={(event) =>
                    setPriority(
                      event.target.value as (typeof PRIORITIES)[number],
                    )
                  }
                >
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {roleLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>Assignee</span>
                <select
                  aria-label="Assignee"
                  className="input w-full"
                  value={assignee}
                  onChange={(event) => setAssignee(event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {members.data?.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span>Due date</span>
                <input
                  className="input w-full sm:max-w-xs"
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </label>
              {create.isError && (
                <p role="alert" className="text-sm text-danger sm:col-span-2">
                  {errorMessage(create.error)}
                </p>
              )}
              <div className="flex justify-end gap-2 sm:col-span-2">
                <button
                  className="min-h-10 rounded-md border border-line px-4"
                  type="button"
                  onClick={() => setCreateOpen(false)}
                >
                  Cancel
                </button>
                <button className="btn" disabled={create.isPending}>
                  {create.isPending ? "Creating…" : "Create task"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {archivePrompt && project.data && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4">
          <section
            aria-labelledby="archive-project-title"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-modal"
            role="alertdialog"
          >
            <h2 id="archive-project-title" className="font-semibold">
              {project.data.status === "ARCHIVED"
                ? "Restore this project?"
                : "Archive this project?"}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {project.data.status === "ARCHIVED"
                ? "The project will be active and available to the team again."
                : "The project will be marked archived. Its tasks and history will remain available."}
            </p>
            {archiveProject.isError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {errorMessage(archiveProject.error)}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="min-h-10 rounded-md border border-line px-4"
                type="button"
                onClick={() => setArchivePrompt(false)}
              >
                Cancel
              </button>
              <button
                className="btn"
                type="button"
                disabled={archiveProject.isPending}
                onClick={() => {
                  archiveProject.mutate(
                    project.data?.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED",
                  );
                  setArchivePrompt(false);
                }}
              >
                {archiveProject.isPending
                  ? "Saving…"
                  : project.data.status === "ARCHIVED"
                    ? "Restore project"
                    : "Archive project"}
              </button>
            </div>
          </section>
        </div>
      )}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4">
          <section
            aria-labelledby="delete-task-title"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-modal"
            role="alertdialog"
          >
            <h2 id="delete-task-title" className="font-semibold">
              Delete “{deleteTarget.title}”?
            </h2>
            <p className="mt-2 text-sm text-muted">
              This task will be permanently removed.
            </p>
            {remove.isError && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {errorMessage(remove.error)}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                className="min-h-10 rounded-md border border-line px-4"
                type="button"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                className="min-h-10 rounded-md bg-danger px-4 font-medium text-white"
                type="button"
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(deleteTarget);
                  setDeleteTarget(null);
                }}
              >
                {remove.isPending ? "Deleting…" : "Delete task"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
