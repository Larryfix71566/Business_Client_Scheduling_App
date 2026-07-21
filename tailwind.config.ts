import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "var(--brand-primary)",
        accent: "var(--brand-accent)",
      },
    },
  },
  plugins: [],
} satisfies Config;
