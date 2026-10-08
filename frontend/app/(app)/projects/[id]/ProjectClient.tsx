"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  api,
  canManage,
  canWrite,
  errorMessage,
  fetchAllPages,
  Org,
  OrgMember,
  Project,
  Status,
  STATUSES,
  Task,
} from "@/lib/api";
import { initials, relativeTime, roleLabel } from "@/lib/format";
import AccessibleDialog from "../../../components/AccessibleDialog";
import DeleteProjectDialog from "../../../components/DeleteProjectDialog";
import QueryError from "../../../components/QueryError";
import { useToast } from "../../../components/ToastProvider";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
type TaskFilters = {
  search: string;
  status: Status | "";
  priority: (typeof PRIORITIES)[number] | "";
  assigned_to: string;
};

function filtersFromQuery(query: string): TaskFilters {
  const params = new URLSearchParams(query);
  const status = params.get("status") ?? "";
  const priority = params.get("priority") ?? "";
  return {
    search: params.get("search") ?? "",
    status: STATUSES.includes(status as Status) ? (status as Status) : "",
    priority: PRIORITIES.includes(priority as (typeof PRIORITIES)[number])
      ? (priority as (typeof PRIORITIES)[number])
      : "",
    assigned_to: params.get("assigned_to") ?? "",
  };
}

function queryWithFilters(query: string, filters: TaskFilters) {
  const params = new URLSearchParams(query);
  for (const key of ["search", "status", "priority", "assigned_to"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
    else params.delete(key);
  }
  return params.toString();
}

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

export default function ProjectClient({ id }: { id: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const qc = useQueryClient();
  const toast = useToast();
  const [filters, setFilters] = useState<TaskFilters>(() =>
    filtersFromQuery(queryString),
  );
  const [searchInput, setSearchInput] = useState(filters.search);
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
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [archivePrompt, setArchivePrompt] = useState(false);
  const [dropTarget, setDropTarget] = useState<Status | null>(null);
  const projectActionsRef = useRef<HTMLButtonElement>(null);
  const querySearchRef = useRef(filters.search);
  const tasksKey = useMemo(
    () => ["tasks", id, filters] as const,
    [id, filters],
  );
  const replaceFiltersInUrl = useCallback(
    (nextFilters: TaskFilters, query = queryString) => {
      const nextQuery = queryWithFilters(query, nextFilters);
      router.replace(`${pathname}${nextQuery ? `?${nextQuery}` : ""}`, {
        scroll: false,
      });
    },
    [pathname, queryString, router],
  );
  useEffect(() => {
    const nextFilters = filtersFromQuery(queryString);
    if (nextFilters.search !== querySearchRef.current) {
      setSearchInput(nextFilters.search);
      querySearchRef.current = nextFilters.search;
    }
    setFilters(nextFilters);
  }, [queryString, querySearchRef]);
  useEffect(() => {
    const nextSearch = searchInput.trim();
    if (nextSearch === filters.search) return;
    const timeout = window.setTimeout(() => {
      const nextFilters = { ...filters, search: nextSearch };
      setFilters(nextFilters);
      querySearchRef.current = nextSearch;
      replaceFiltersInUrl(nextFilters);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput, filters, querySearchRef, replaceFiltersInUrl]);
  const changeFilter = <K extends keyof TaskFilters>(
    key: K,
    value: TaskFilters[K],
  ) => {
    const nextFilters = { ...filters, [key]: value };
    setFilters(nextFilters);
    replaceFiltersInUrl(nextFilters);
  };
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
  const tasks = useQuery<{ results: Task[]; count?: number }>({
    queryKey: tasksKey,
    queryFn: async () => {
      const params = new URLSearchParams({ project: id });
      if (filters.search) params.set("search", filters.search);
      if (filters.status) params.set("status", filters.status);
      if (filters.priority) params.set("priority", filters.priority);
      if (filters.assigned_to) params.set("assigned_to", filters.assigned_to);
      let count: number | undefined;
      const results = await fetchAllPages<Task>(
        `/api/tasks/?${params.toString()}`,
        (page) => {
          count = page.count ?? count;
        },
      );
      return {
        results,
        count,
      };
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
      toast("success", "Task created.");
    },
    onError: (error) => toast("error", errorMessage(error)),
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
              results:
                filters.status && filters.status !== status
                  ? current.results.filter((item) => item.id !== task.id)
                  : current.results.map((item) =>
                      item.id === task.id ? { ...item, status } : item,
                    ),
            }
          : current,
      );
      return { prev, queryKey: tasksKey };
    },
    onError: (_error, _variables, context) => {
      if (context) qc.setQueryData(context.queryKey, context.prev);
      toast("error", "Couldn't move task. Reverted.");
    },
    onSuccess: () => toast("success", "Task moved."),
    onSettled: () => qc.invalidateQueries({ queryKey: ["tasks", id] }),
  });
  const remove = useMutation({
    mutationFn: (t: Task) => api(`/api/tasks/${t.id}/`, { method: "DELETE" }),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["tasks", id] });
      toast("success", "Task deleted.");
    },
    onError: (error) => toast("error", errorMessage(error)),
  });
  const updateProject = useMutation({
    mutationFn: () =>
      api(`/api/projects/${id}/`, { method: "PATCH", json: draft }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["project", id] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      setEditing(false);
      toast("success", "Project updated.");
    },
    onError: (error) => toast("error", errorMessage(error)),
  });
  const archiveProject = useMutation({
    mutationFn: (status: Project["status"]) =>
      api(`/api/projects/${id}/`, { method: "PATCH", json: { status } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["project", id] });
      await qc.invalidateQueries({ queryKey: ["projects"] });
      setArchivePrompt(false);
      toast("success", "Project status updated.");
    },
    onError: (error) => toast("error", errorMessage(error)),
  });
  const list = tasks.data?.results ?? [];
  useEffect(() => {
    if (!actionsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActionsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [actionsOpen]);
  const queryError =
    project.error ?? orgs.error ?? members.error ?? tasks.error;
  if (queryError) {
    return (
      <main className="px-4 py-8 sm:px-6">
        <QueryError
          error={queryError}
          resource="project"
          onRetry={() => void qc.invalidateQueries()}
        />
      </main>
    );
  }
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
            <h1 className="page-title text-[28px] font-semibold">
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
              ref={projectActionsRef}
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
                <div className="my-1 border-t border-line" aria-hidden="true" />
                <button
                  type="button"
                  className="min-h-10 w-full rounded-md px-3 text-left text-sm text-danger hover:bg-danger-surface"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setDeleteProjectOpen(true);
                    setActionsOpen(false);
                  }}
                >
                  Delete project
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
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">Filter by status</span>
          <select
            aria-label="Filter by status"
            className="input w-auto"
            value={filters.status}
            onChange={(event) =>
              changeFilter("status", event.target.value as Status | "")
            }
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by priority</span>
          <select
            aria-label="Filter by priority"
            className="input w-auto"
            value={filters.priority}
            onChange={(event) =>
              changeFilter(
                "priority",
                event.target.value as TaskFilters["priority"],
              )
            }
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
            value={filters.assigned_to}
            onChange={(event) =>
              changeFilter("assigned_to", event.target.value)
            }
          >
            <option value="">All assignees</option>
            {members.data?.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn shrink-0 whitespace-nowrap"
          onClick={() => {
            const cleared: TaskFilters = {
              search: "",
              status: "",
              priority: "",
              assigned_to: "",
            };
            setFilters(cleared);
            setSearchInput("");
            querySearchRef.current = "";
            replaceFiltersInUrl(cleared);
          }}
        >
          Clear filters
        </button>
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
      {tasks.isFetching && (
        <p role="status" className="text-sm text-muted">
          Loading tasks…
        </p>
      )}
      {!tasks.isFetching && list.length === 0 && (
        <p
          role="status"
          className="rounded-lg border border-line p-4 text-sm text-muted"
        >
          No tasks match these filters
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
            <h2 className="sticky top-16 z-10 mb-2 flex items-center justify-between rounded-md bg-surface px-2 py-2 text-sm font-semibold">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full bg-accent"
                />
                {STATUS_LABELS[col]}
              </span>
              <span className="text-xs font-normal text-muted">
                {
                  list.filter(
                    (task) =>
                      task.status === col &&
                      (!filters.status || filters.status === col),
                  ).length
                }
              </span>
            </h2>
            <div className="min-h-24 space-y-2">
              {list
                .filter(
                  (task) =>
                    task.status === col &&
                    (!filters.status || filters.status === col),
                )
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
                      className="group rounded-md border border-line bg-surface p-3 transition-[box-shadow,transform] active:cursor-grabbing active:shadow-modal"
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
                              className="input min-h-10 w-full py-1 text-xs"
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
                            className="min-h-10 rounded-md px-3 text-xs text-danger underline underline-offset-2"
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
      {createOpen && (
        <AccessibleDialog
          labelledBy="new-task-title"
          className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-modal"
          onClose={() => setCreateOpen(false)}
        >
          <h2 id="new-task-title" className="page-title text-xl font-semibold">
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
                  setPriority(event.target.value as (typeof PRIORITIES)[number])
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
        </AccessibleDialog>
      )}
      {archivePrompt && project.data && (
        <AccessibleDialog
          labelledBy="archive-project-title"
          className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-modal"
          onClose={() => setArchivePrompt(false)}
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
              disabled={archiveProject.isPending}
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
              }}
            >
              {archiveProject.isPending
                ? "Saving…"
                : project.data.status === "ARCHIVED"
                  ? "Restore project"
                  : "Archive project"}
            </button>
          </div>
        </AccessibleDialog>
      )}
      {deleteProjectOpen && project.data && manageable && (
        <DeleteProjectDialog
          project={project.data}
          taskCount={
            !filters.search &&
            !filters.status &&
            !filters.priority &&
            !filters.assigned_to
              ? tasks.data?.count
              : undefined
          }
          onClose={() => setDeleteProjectOpen(false)}
          returnFocusRef={projectActionsRef}
          onArchiveInstead={() => {
            setDeleteProjectOpen(false);
            setArchivePrompt(true);
          }}
        />
      )}
      {deleteTarget && (
        <AccessibleDialog
          labelledBy="delete-task-title"
          className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-6 shadow-modal"
          onClose={() => setDeleteTarget(null)}
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
              disabled={remove.isPending}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </button>
            <button
              className="min-h-10 rounded-md bg-danger-surface px-4 font-medium text-on-danger"
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(deleteTarget);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete task"}
            </button>
          </div>
        </AccessibleDialog>
      )}
    </main>
  );
}
