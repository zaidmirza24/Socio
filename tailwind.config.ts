import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
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
      colors: {
        // Samajwadi Party palette. Existing blue/indigo/sky/violet utilities
        // are remapped so the whole app picks up SP red and SP green.
        blue: {
          50: "#fef2f1", 100: "#fde3e1", 200: "#fbcbc8", 300: "#f7a19c", 400: "#f06b63",
          500: "#e8453b", 600: "#E2231A", 700: "#bd1a13", 800: "#9b1a15", 900: "#801b17", 950: "#450a08",
        },
        sky: {
          50: "#fef2f1", 100: "#fde3e1", 200: "#fbcbc8", 300: "#f7a19c", 400: "#f06b63",
          500: "#e8453b", 600: "#E2231A", 700: "#bd1a13", 800: "#9b1a15", 900: "#801b17", 950: "#450a08",
        },
        indigo: {
          50: "#effef4", 100: "#d9ffe5", 200: "#b5fccb", 300: "#7bf5a3", 400: "#3de374",
          500: "#14c855", 600: "#009933", 700: "#00802b", 800: "#046524", 900: "#05521f", 950: "#002e10",
        },
        violet: {
          50: "#effef4", 100: "#d9ffe5", 200: "#b5fccb", 300: "#7bf5a3", 400: "#3de374",
          500: "#14c855", 600: "#009933", 700: "#00802b", 800: "#046524", 900: "#05521f", 950: "#002e10",
        },
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [],
};

export default config;
