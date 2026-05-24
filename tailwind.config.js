/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdf6',
          100: '#dcfce9',
          200: '#bbf7d4',
          300: '#86efb0',
          400: '#4ade83',
          500: '#1D9E75',
          600: '#16a35e',
          700: '#15804a',
          800: '#16653d',
          900: '#145334',
          950: '#052e1a',
        },
      },
    },
  },
  plugins: [],
}
