import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/auth.css';
import './styles/shell.css';
import './styles/dashboard.css';
import './styles/audit-logs.css';
import WeCookedAdmin from './App.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WeCookedAdmin />
  </React.StrictMode>
);
