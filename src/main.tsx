import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App';
import './style.css';
import './panel-details.css';
import './overlay.css';
import './nagneon.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
