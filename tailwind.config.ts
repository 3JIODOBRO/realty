import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eef6f3', 100: '#d5eae2', 500: '#1f7a5c', 600: '#18644b', 700: '#124d3a' },
        ink: { 400: '#8a8f98', 500: '#5f6670', 700: '#2b2f36', 900: '#14161a' },
        read: '#2f80ed',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
