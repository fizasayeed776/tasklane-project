module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        muted: "var(--muted)",
        paper: "var(--background)",
        surface: "var(--surface)",
        line: "var(--border)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        warn: "var(--warning)",
        danger: "var(--danger)",
        "danger-surface": "var(--danger-surface)",
        "on-danger": "var(--on-danger)",
        success: "var(--success)",
      },
      borderRadius: { md: "8px", lg: "12px" },
      boxShadow: {
        modal: "0 12px 32px rgb(22 33 29 / 0.12)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "sans-serif"],
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
      },
    },
  },
};
