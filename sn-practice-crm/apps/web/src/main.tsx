import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRoot } from './app';
import './styles.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <AppRoot />
    </StrictMode>,
  );
}
