"use client";

import { useState } from "react";

type PasswordFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  required?: boolean;
  minLength?: number;
};

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  required = true,
  minLength,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const placeholder = label === "Password" ? "Password" : undefined;
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <span className="flex gap-2">
        <input
          id={id}
          className="input"
          type={visible ? "text" : "password"}
          placeholder={placeholder}
          autoComplete={autoComplete}
          minLength={minLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required={required}
        />
        <button
          type="button"
          className="min-h-10 shrink-0 rounded-md border border-line px-3 text-sm hover:bg-accent-soft"
          onClick={() => setVisible((value) => !value)}
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}
