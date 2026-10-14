import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Em dev, /api vai para o server/ (:3000). Mesma origem que em produção, então o
  // cookie de sessão do Better Auth funciona sem depender de CORS. No docker-compose o
  // server é outro container, então o alvo vem de API_PROXY_TARGET.
  server: { proxy: { '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000' } },
})
