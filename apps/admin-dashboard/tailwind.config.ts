import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Serenity Royale Hospital brand colors
        serenity: {
          50: '#f8fafc',
          100: '#eef2f7',
          200: '#d9e1ee',
          300: '#aab7ca',
          400: '#7c8ba4',
          500: '#4f5f7a',
          600: '#34425f',
          700: '#1f2a44',
          800: '#111a32',
          900: '#070d24',
          950: '#020617',
        },
        gold: {
          50: '#fffbea',
          100: '#fff3c4',
          200: '#fee68a',
          300: '#f8d24e',
          400: '#f2c230',
          500: '#d9a515',
          600: '#b27d0f',
          700: '#8f5f10',
          800: '#744d14',
          900: '#633f16',
          950: '#3a2107',
        },
        teal: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
      },
    },
  },
  plugins: [],
}

export default config
