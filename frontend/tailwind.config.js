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
        success: "var(--success)",
      },
      borderRadius: { md: "8px", lg: "12px" },
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "sans-serif"],
        serif: ["var(--font-fraunces)", "Georgia", "serif"],
      },
    },
  },
};
