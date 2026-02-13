import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@components': path.resolve(__dirname, './src/components'),
            '@pages': path.resolve(__dirname, './src/pages'),
            '@hooks': path.resolve(__dirname, './src/hooks'),
            '@store': path.resolve(__dirname, './src/store'),
            '@services': path.resolve(__dirname, './src/services'),
            '@utils': path.resolve(__dirname, './src/utils'),
            '@types': path.resolve(__dirname, './src/types'),
        },
    },
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
            '/socket.io': {
                target: 'http://localhost:3000',
                ws: true,
            },
        },
    },
    build: {
        outDir: 'dist',
        sourcemap: false, // Disable sourcemaps in production for smaller builds
        target: 'esnext',
        minify: 'esbuild', // Use esbuild (built-in, faster than terser)
        rollupOptions: {
            output: {
                manualChunks: {
                    // Vendor chunks - separate heavy libraries
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-ui': ['@headlessui/react', 'clsx'],
                    'vendor-dnd': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
                    'vendor-charts': ['recharts'],
                    'vendor-map': ['leaflet'],
                    'vendor-date': ['date-fns'],
                },
            },
        },
        chunkSizeWarningLimit: 500,
    },
    // Optimize deps for faster dev startup
    optimizeDeps: {
        include: ['react', 'react-dom', 'react-router-dom', 'date-fns'],
    },
    // Enable esbuild optimizations
    esbuild: {
        drop: ['console', 'debugger'], // Remove console.log and debugger in production
    },
});
