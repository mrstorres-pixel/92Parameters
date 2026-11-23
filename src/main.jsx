import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import SecureBoundary from './components/auth/SecureBoundary.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SecureBoundary><App /></SecureBoundary>
  </React.StrictMode>,
)
