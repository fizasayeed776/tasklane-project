"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type ToastKind = "success" | "error";
type ToastItem = { id: number; kind: ToastKind; message: string };
type ToastContextValue = (kind: ToastKind, message: string) => void;

const ToastContext = createContext<ToastContextValue | null>(null);

function Toast({
  item,
  dismiss,
}: {
  item: ToastItem;
  dismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timeout = window.setTimeout(() => dismiss(item.id), 5000);
    return () => window.clearTimeout(timeout);
  }, [dismiss, item.id]);

  return (
    <li
      className={`flex min-h-12 items-center gap-3 rounded-lg border bg-surface px-4 py-3 text-sm ${
        item.kind === "error"
          ? "border-danger text-danger"
          : "border-success text-success"
      }`}
      role={item.kind === "error" ? "alert" : "status"}
    >
      <span className="min-w-0 flex-1">{item.message}</span>
      <button
        type="button"
        className="grid size-10 shrink-0 place-items-center rounded-md hover:bg-accent-soft"
        aria-label="Dismiss notification"
        onClick={() => dismiss(item.id)}
      >
        ×
      </button>
    </li>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const notify = useCallback<ToastContextValue>((kind, message) => {
    const id = ++nextId.current;
    setItems((current) => [...current, { id, kind, message }].slice(-4));
  }, []);
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4">
        <ul
          aria-label="Messages"
          className="pointer-events-auto flex w-full max-w-md flex-col gap-2"
        >
          {items.map((item) => (
            <Toast key={item.id} item={item} dismiss={dismiss} />
          ))}
        </ul>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) {
    throw new Error("useToast must be used within ToastProvider.");
  }
  return notify;
}
