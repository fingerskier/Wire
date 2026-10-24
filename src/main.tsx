import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// No StrictMode: its double-mounted effects would open two Telegram
// connections on the same session in development.
createRoot(document.getElementById('root')!).render(<App />)
