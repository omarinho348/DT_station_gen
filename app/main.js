import './styles/tokens.css';
import './styles/base.css';
import './styles/setup.css';
import './styles/twin.css';
import { startRouter } from './router.js';
import { SetupPage } from './pages/setup/SetupPage.js';
import { TwinPage } from './pages/twin/TwinPage.js';

const stop = startRouter({ setup: SetupPage, twin: TwinPage }, document.getElementById('app'));

if (import.meta.hot) import.meta.hot.dispose(stop);
