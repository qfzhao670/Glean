import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { initialize } from './api';
initialize().then(() => ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>)).catch(() => { document.getElementById('root')!.textContent = '本地服务初始化失败，请重新启动拾知。'; });
