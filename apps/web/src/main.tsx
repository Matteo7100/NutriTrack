/** Punto di ingresso: monta React e registra la sola cache della shell applicativa. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js').catch(() => { /* La UI continua online se lo storage non è disponibile. */ });
}
