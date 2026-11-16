// Tiny hash router: #/setup[/<step>] and #/twin. Hash routing keeps the whole app in one
// page, so setup state (crew, brief, docs) is still in memory when the twin page opens.

export const PAGES = ['setup', 'twin', 'gallery'];

/**
 * "#/setup/brief?theme=dark" -> { page: 'setup', sub: 'brief', query: { theme: 'dark' } }.
 * Anything unknown -> setup.
 */
export function resolveRoute(hash = '') {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  const page = PAGES.includes(parts[0]) ? parts[0] : 'setup';
  return {
    page,
    sub: page === parts[0] ? (parts[1] ?? null) : null,
    query: Object.fromEntries(new URLSearchParams(search)),
  };
}

export function href(page, sub) {
  return sub ? `#/${page}/${sub}` : `#/${page}`;
}

/**
 * pages: { [name]: (outlet, route) => ({ update?(route), unmount?() }) }
 * A page instance is kept while only `sub` changes (e.g. setup steps), so it can animate between steps.
 */
export function startRouter(pages, outlet) {
  let current = null;
  let currentPage = null;

  const go = () => {
    const route = resolveRoute(location.hash);
    if (route.page === currentPage && current?.update) {
      current.update(route);
      return;
    }
    current?.unmount?.();
    window.__appReady = false;
    outlet.replaceChildren();
    currentPage = route.page;
    current = pages[route.page](outlet, route);
  };

  window.addEventListener('hashchange', go);
  go();
  return () => {
    window.removeEventListener('hashchange', go);
    current?.unmount?.();
  };
}
