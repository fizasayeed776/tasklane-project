"use client";

import { ReactNode, RefObject, useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AccessibleDialog({
  children,
  className,
  labelledBy,
  onClose,
  role = "dialog",
  returnFocusRef,
}: {
  children: ReactNode;
  className: string;
  labelledBy: string;
  onClose: () => void;
  role?: "dialog" | "alertdialog";
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const requestedFocusTarget = returnFocusRef?.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const getFocusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter(
        (element) =>
          !element.hasAttribute("hidden") &&
          element.getAttribute("aria-hidden") !== "true",
      );
    getFocusable()[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const focusTarget = requestedFocusTarget ?? previouslyFocused;
      if (focusTarget?.isConnected) focusTarget.focus();
    };
  }, [returnFocusRef]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/35 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <section
        ref={dialog}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={className}
        role={role}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}
