/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Couleurs principales de la marque
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        // Couleurs pour les statuts
        status: {
          pending: '#f59e0b',    // Jaune - à faire
          progress: '#3b82f6',   // Bleu - en cours
          done: '#10b981',       // Vert - terminé
          incident: '#ef4444',   // Rouge - incident
          cancelled: '#6b7280',  // Gris - annulé
        },
        // Couleurs pour les types
        type: {
          livraison: '#8b5cf6',   // Violet
          ramassage: '#f97316',   // Orange
          both: '#06b6d4',        // Cyan
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
    },
  },
  plugins: [],
}
