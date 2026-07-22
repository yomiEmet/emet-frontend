import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // PORT 环境变量可覆盖：多个会话并行起 dev server 时不抢 5173（worker CORS 放行任意 localhost 端口）
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
  },
})
