import './styles/tokens.css';
import './styles/base.css';
import './styles/setup.css';
import './styles/twin.css';
import './styles/builder.css';
import './styles/spec.css';
import './styles/gallery.css';
import { startRouter } from './router.js';
import { SetupPage } from './pages/setup/SetupPage.js';
import { TwinPage } from './pages/twin/TwinPage.js';
import { GalleryPage } from './pages/gallery/GalleryPage.js';

const stop = startRouter({ setup: SetupPage, twin: TwinPage, gallery: GalleryPage }, document.getElementById('app'));

if (import.meta.hot) import.meta.hot.dispose(stop);
