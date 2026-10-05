import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { initialize } from './api';
import { getPreference } from './preferences';

// Apply the persisted theme before React mounts so the first painted frame
// already uses the correct palette and background.
const initialTheme = getPreference('glean-theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = initialTheme;
document.documentElement.style.colorScheme = initialTheme;

initialize().then(() => ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)).catch(() => { document.getElementById('root')!.textContent = '本地服务初始化失败，请重新启动拾知。'; });
