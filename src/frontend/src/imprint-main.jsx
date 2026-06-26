import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import ImprintPage from './pages/ImprintPage';
import './index.css';

function Root() {
  useEffect(() => {
    const t = localStorage.getItem('dnsrr-theme');
    document.documentElement.setAttribute('data-theme', t || 'dnsrrlight');
  }, []);

  return (
    <StrictMode>
      <ImprintPage />
    </StrictMode>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
