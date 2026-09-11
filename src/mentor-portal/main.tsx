import React from 'react'
import { createRoot } from 'react-dom/client'
import { MentorApp } from './MentorApp'
import './mentor.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MentorApp />
  </React.StrictMode>
)
