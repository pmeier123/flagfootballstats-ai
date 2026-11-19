export interface Route { name: string; params: string[] }

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const [name = '', ...params] = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: name || 'home', params };
}

export const route: Route = $state(parse(location.hash));

function update(): void {
  const r = parse(location.hash);
  route.name = r.name;
  route.params = r.params;
}

window.addEventListener('hashchange', update);

export function go(path: string): void {
  location.hash = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
}

export function href(path: string): string {
  return `#/${path.replace(/^\//, '')}`;
}
