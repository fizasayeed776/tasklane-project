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
  Project,
  Status,
  STATUSES,
  Task,
} from "@/lib/api";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [search, setSearch] = useState(""),
    [title, setTitle] = useState(""),
    [assignee, setAssignee] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "" });
  const tasksKey = ["tasks", id, search];
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
    queryFn: () =>
      api(`/api/tasks/?project=${id}&search=${encodeURIComponent(search)}`),
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
          assigned_to: assignee ? Number(assignee) : null,
        },
      }),
    onSuccess: () => {
      setTitle("");
      qc.invalidateQueries({ queryKey: ["tasks", id] });
    },
  });
  const move = useMutation({
    mutationFn: ({ task, status }: { task: Task; status: Status }) =>
      api(`/api/tasks/${task.id}/`, { method: "PATCH", json: { status } }),
    onMutate: async ({ task, status }) => {
      // optimistic update
      await qc.cancelQueries({ queryKey: tasksKey });
      const prev = qc.getQueryData<{ results: Task[] }>(tasksKey);
      qc.setQueryData(tasksKey, (d: any) => ({
        ...d,
        results: d.results.map((t: Task) =>
          t.id === task.id ? { ...t, status } : t,
        ),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(tasksKey, ctx?.prev), // rollback
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
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <Link href="/dashboard" className="text-sm underline">
        Back to dashboard
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{project.data?.name}</h1>
        {role && (
          <span className="rounded-full bg-line px-3 py-1 text-xs font-medium">
            {role}
          </span>
        )}
        {manageable && !editing && (
          <button className="btn ml-auto" onClick={() => setEditing(true)}>
            Edit project
          </button>
        )}
        {manageable && project.data && (
          <button
            className="rounded-md border border-line px-3 py-1.5 text-sm"
            onClick={() =>
              archiveProject.mutate(
                project.data?.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED",
              )
            }
          >
            {project.data.status === "ARCHIVED"
              ? "Restore project"
              : "Archive project"}
          </button>
        )}
      </header>
      <p className="text-sm">
        {project.data?.description && `${project.data.description} · `}
        {list.length} tasks · {list.filter((t) => t.status === "DONE").length}{" "}
        done · {members.data?.length ?? 0} members
      </p>
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
        <h2 className="font-semibold">
          Organization members ({members.data?.length ?? 0})
        </h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {members.data?.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-2 rounded-md bg-line/50 px-2 py-1"
            >
              <span>{member.name}</span>
              <span className="text-muted">{member.email}</span>
              <span className="rounded-full bg-line px-2 py-0.5 text-xs font-medium">
                {member.role}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <div className="flex flex-wrap gap-2">
        <input
          className="input max-w-xs"
          placeholder="Search tasks"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {writable && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <input
              className="input"
              placeholder="New task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <select
              aria-label="Assignee"
              className="input w-auto"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">Unassigned</option>
              {members.data?.map((m: any) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button className="btn shrink-0 whitespace-nowrap">Add task</button>
            {create.isError && (
              <p role="alert" className="text-sm text-warn">
                {errorMessage(create.error)}
              </p>
            )}
          </form>
        )}
      </div>
      {move.isError && (
        <p role="alert" className="text-sm text-warn">
          Could not move that task: {errorMessage(move.error)}. It was put back.
        </p>
      )}
      {remove.isError && (
        <p role="alert" className="text-sm text-warn">
          {errorMessage(remove.error)}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-4">
        {STATUSES.map((col) => (
          <section
            key={col}
            className="rounded-lg bg-line/50 p-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              const t = list.find(
                (x) => x.id === Number(e.dataTransfer.getData("id")),
              );
              if (t && t.status !== col && writable)
                move.mutate({ task: t, status: col });
            }}
          >
            <h2 className="mb-2 px-1 text-sm font-semibold">
              {col.replace("_", " ")} (
              {list.filter((t) => t.status === col).length})
            </h2>
            <div className="min-h-24 space-y-2">
              {list
                .filter((t) => t.status === col)
                .map((t) => (
                  <article
                    key={t.id}
                    draggable={writable}
                    onDragStart={(e) =>
                      e.dataTransfer.setData("id", String(t.id))
                    }
                    className="panel cursor-grab p-3"
                  >
                    <Link
                      href={`/tasks/${t.id}`}
                      className="font-medium underline"
                    >
                      {t.title}
                    </Link>
                    <p className="mt-1 text-xs">
                      {t.priority} · {t.assigned_to_name ?? "Unassigned"}
                    </p>
                    {manageable && (
                      <button
                        className="mt-1 text-xs underline"
                        onClick={() => remove.mutate(t)}
                      >
                        Delete
                      </button>
                    )}
                  </article>
                ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
