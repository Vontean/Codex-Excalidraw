/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./export.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d2433",
        panel: "#f8fafc",
        line: "#d8dee8",
        cobalt: "#1f6feb",
        coral: "#e85d4f"
      },
      boxShadow: {
        toolbar: "0 10px 30px rgba(29, 36, 51, 0.08)"
      }
    }
  },
  plugins: []
};
