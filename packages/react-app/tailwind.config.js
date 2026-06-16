/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        // Poppins is the app typeface (self-hosted via @fontsource/poppins)
        sans: [
          "Poppins",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // ── v1.3 semantic tokens ────────────────────────────────────────────
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          bg: "hsl(var(--success-bg))",
          border: "hsl(var(--success-border))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          bg: "hsl(var(--warning-bg))",
          border: "hsl(var(--warning-border))",
        },
        error: {
          DEFAULT: "hsl(var(--error))",
          foreground: "hsl(var(--error-foreground))",
          bg: "hsl(var(--error-bg))",
          border: "hsl(var(--error-border))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
          bg: "hsl(var(--info-bg))",
          border: "hsl(var(--info-border))",
        },
        // ── Status token group ──────────────────────────────────────────────
        // bg-status-todo/10 etc. work via CSS variable references
        "status-todo": {
          DEFAULT: "hsl(var(--status-todo))",
          fg: "hsl(var(--status-todo-fg))",
          bg: "hsl(var(--status-todo-bg))",
          text: "hsl(var(--status-todo-text))",
          border: "hsl(var(--status-todo-border))",
        },
        "status-inprogress": {
          DEFAULT: "hsl(var(--status-inprogress))",
          fg: "hsl(var(--status-inprogress-fg))",
          bg: "hsl(var(--status-inprogress-bg))",
          text: "hsl(var(--status-inprogress-text))",
          border: "hsl(var(--status-inprogress-border))",
        },
        "status-codereview": {
          DEFAULT: "hsl(var(--status-codereview))",
          fg: "hsl(var(--status-codereview-fg))",
          bg: "hsl(var(--status-codereview-bg))",
          text: "hsl(var(--status-codereview-text))",
          border: "hsl(var(--status-codereview-border))",
        },
        "status-done": {
          DEFAULT: "hsl(var(--status-done))",
          fg: "hsl(var(--status-done-fg))",
          bg: "hsl(var(--status-done-bg))",
          text: "hsl(var(--status-done-text))",
          border: "hsl(var(--status-done-border))",
        },
        "status-blocked": {
          DEFAULT: "hsl(var(--status-blocked))",
          fg: "hsl(var(--status-blocked-fg))",
          bg: "hsl(var(--status-blocked-bg))",
          text: "hsl(var(--status-blocked-text))",
          border: "hsl(var(--status-blocked-border))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",         /* rounded-lg = cards */
        md: "calc(var(--radius) - 2px)", /* rounded-md = controls */
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
