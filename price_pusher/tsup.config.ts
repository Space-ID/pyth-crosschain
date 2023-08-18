import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts'],
    platform: 'node',
    splitting: false,
    sourcemap: false,
    clean: true,
    outDir: 'lib',
})
