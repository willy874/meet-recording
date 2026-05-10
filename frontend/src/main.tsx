import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript'
import '@fontsource/roboto-flex/400.css'
import './index.css'
import { theme } from './theme'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <InitColorSchemeScript attribute="data-mui-color-scheme" defaultMode="system" />
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline enableColorScheme />
      <App />
    </ThemeProvider>
  </StrictMode>,
)
