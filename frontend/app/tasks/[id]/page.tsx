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
  Task,
} from "@/lib/api";

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    priority: "MEDIUM",
    status: "TODO",
    assigned_to: "",
    due_date: "",
  });
  const task = useQuery<Task>({
    queryKey: ["task", id],
    queryFn: () => api(`/api/tasks/${id}/`),
  });
  const orgs = useQuery<Org[]>({
    queryKey: ["orgs"],
    queryFn: () => api("/api/organizations/"),
  });
  const me = useQuery<{ id: number }>({
    queryKey: ["me"],
    queryFn: () => api("/api/auth/me/"),
  });
  const comments = useQuery({
    queryKey: ["comments", id],
    queryFn: () => api(`/api/tasks/${id}/comments/`),
  });
  const activity = useQuery({
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
      setDraft({
        title: task.data.title,
        description: task.data.description,
        priority: task.data.priority,
        status: task.data.status,
        assigned_to: task.data.assigned_to ? String(task.data.assigned_to) : "",
        due_date: task.data.due_date ?? "",
      });
    }
  }, [task.data]);
  const refresh = () =>
    ["comments", "task-activity"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k, id] }),
    );
  const add = useMutation({
    mutationFn: () =>
      api(`/api/tasks/${id}/comments/`, {
        method: "POST",
        json: { content: text },
      }),
    onSuccess: () => {
      setText("");
      refresh();
    },
  });
  const del = useMutation({
    mutationFn: (cid: number) =>
      api(`/api/comments/${cid}/`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const updateTask = useMutation({
    mutationFn: () =>
      api(`/api/tasks/${id}/`, {
        method: "PATCH",
        json: {
          ...draft,
          assigned_to: draft.assigned_to ? Number(draft.assigned_to) : null,
          due_date: draft.due_date || null,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["task", id] });
      await qc.invalidateQueries({
        queryKey: ["tasks", String(task.data?.project)],
      });
      setEditing(false);
    },
  });
  const t = task.data;
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      {t && (
        <Link href={`/projects/${t.project}`} className="text-sm underline">
          Back to project
        </Link>
      )}
      <header className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{t?.title}</h1>
        {canEditTask && !editing && (
          <button className="btn ml-auto" onClick={() => setEditing(true)}>
            Edit task
          </button>
        )}
      </header>
      {editing && (
        <form
          className="panel space-y-3"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            updateTask.mutate();
          }}
        >
          <h2 className="font-semibold">Edit task</h2>
          <label className="block space-y-1 text-sm">
            <span>Title</span>
            <input
              className="input"
              value={draft.title}
              onChange={(event) =>
                setDraft({ ...draft, title: event.target.value })
              }
              required
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Description</span>
            <textarea
              className="input"
              rows={4}
              value={draft.description}
              onChange={(event) =>
                setDraft({ ...draft, description: event.target.value })
              }
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm">
              <span>Priority</span>
              <select
                className="input"
                value={draft.priority}
                onChange={(event) =>
                  setDraft({ ...draft, priority: event.target.value })
                }
              >
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => (
                  <option key={priority}>{priority}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>Status</span>
              <select
                className="input"
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value })
                }
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>Assignee</span>
              <select
                className="input"
                value={draft.assigned_to}
                onChange={(event) =>
                  setDraft({ ...draft, assigned_to: event.target.value })
                }
              >
                <option value="">Unassigned</option>
                {members.data?.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span>Due date</span>
              <input
                className="input"
                type="date"
                value={draft.due_date}
                onChange={(event) =>
                  setDraft({ ...draft, due_date: event.target.value })
                }
              />
            </label>
          </div>
          {updateTask.isError && (
            <p role="alert" className="text-sm text-warn">
              {errorMessage(updateTask.error)}
            </p>
          )}
          <div className="flex gap-2">
            <button className="btn" disabled={updateTask.isPending}>
              {updateTask.isPending ? "Saving…" : "Save changes"}
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
      <section className="panel text-sm">
        <p>{t?.description || "No description."}</p>
        <p className="mt-2">
          Status: {t?.status} · Priority: {t?.priority} · Assignee:{" "}
          {t?.assigned_to_name ?? "Unassigned"} · Created by{" "}
          {t?.created_by_name} · Due: {t?.due_date ?? "no date"}
        </p>
      </section>
      <section className="panel">
        <h2 className="mb-2 font-semibold">Comments</h2>
        <ul className="space-y-2 text-sm">
          {comments.data?.map((c: any) => (
            <li key={c.id}>
              <b>{c.user_name}</b>: {c.content}{" "}
              {canWrite(orgRole) &&
                (c.user === me.data?.id || canManage(orgRole)) && (
                  <button
                    className="underline"
                    onClick={() => del.mutate(c.id)}
                  >
                    Delete
                  </button>
                )}
            </li>
          ))}
        </ul>
        {canWrite(orgRole) && (
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <input
              className="input"
              placeholder="Write a comment"
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
            <button className="btn">Comment</button>
          </form>
        )}
        {(add.isError || del.isError) && (
          <p role="alert" className="mt-2 text-sm text-warn">
            {errorMessage(add.error || del.error)}
          </p>
        )}
      </section>
      <section className="panel">
        <h2 className="mb-2 font-semibold">History</h2>
        <ul className="space-y-1 text-sm">
          {activity.data?.map((a: any) => (
            <li key={a.id}>{a.message}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
