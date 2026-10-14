import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import Landing from './pages/Landing'
import App from './pages/app/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Navigate to="/app/home" replace />} />
        <Route path="/app/:tab" element={<App />} />
      </Routes>
    </HashRouter>
  </StrictMode>,
)
