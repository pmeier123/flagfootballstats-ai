<script lang="ts">
  import { app, initApp } from './lib/app.svelte';
  import { href, route } from './lib/router.svelte';
  import SyncBadge from './components/SyncBadge.svelte';
  import GamesPage from './pages/GamesPage.svelte';
  import GamePage from './pages/GamePage.svelte';
  import CapturePage from './pages/CapturePage.svelte';
  import PreviewPage from './pages/PreviewPage.svelte';
  import PlayersPage from './pages/PlayersPage.svelte';
  import ImportPage from './pages/ImportPage.svelte';
  import SettingsPage from './pages/SettingsPage.svelte';
  import TickerPage from './pages/TickerPage.svelte';

  let failed = $state('');
  initApp().catch((e) => { failed = e instanceof Error ? e.message : String(e); });

  let isAdmin = $derived(app.user?.role === 'admin');
  let canUse = $derived(!!app.user && (!app.backendConfigured || app.user.role !== 'viewer' || route.name === 'settings'));
  const active = (n: string) => (route.name === n || (n === 'home' && ['game', 'capture', 'preview'].includes(route.name)) ? 'nav active' : 'nav');
</script>

{#if route.name === 't'}
  <!-- Public ticker: no login, nothing else of the app is reachable from here. -->
  <TickerPage token={route.params[0] ?? ''} />
{:else if failed}
  <div class="shell"><div class="banner error" style="margin-top:1rem">Die App konnte nicht gestartet werden: {failed}</div></div>
{:else if !app.ready}
  <div class="shell"><p class="muted" style="margin-top:2rem;text-align:center">Lade …</p></div>
{:else}
  <header class="topbar">
    <div class="topbar-inner">
      <span class="brand">FF Stats</span>
      {#if app.user}
        <a class={active('home')} href={href('')}>Spiele</a>
        {#if isAdmin || !app.backendConfigured}
          <a class={active('players')} href={href('players')}>Spieler</a>
          <a class={active('import')} href={href('import')}>Import</a>
        {/if}
      {/if}
      <a class={active('settings')} href={href('settings')}>Einstellungen</a>
      <span class="grow"></span>
      {#if route.name !== 'capture'}<SyncBadge />{/if}
    </div>
  </header>
  <main class="shell" style="padding-top:1rem">
    {#if app.backendConfigured && !app.user && route.name !== 'settings'}
      <div class="card">
        <h1>Anmelden</h1>
        <p>Bitte melde dich an, um Spiele zu erfassen oder zu verwalten.</p>
        <a class="btn primary" href={href('settings')} data-testid="to-login">Zur Anmeldung</a>
      </div>
    {:else if !canUse}
      <div class="banner warn">Dein Konto hat nur Leserechte.</div>
    {:else if route.name === 'players'}<PlayersPage />
    {:else if route.name === 'import'}<ImportPage />
    {:else if route.name === 'settings'}<SettingsPage />
    {:else if route.name === 'game'}{#key route.params[0]}<GamePage gameId={route.params[0] ?? ''} />{/key}
    {:else if route.name === 'capture'}{#key route.params[0]}<CapturePage gameId={route.params[0] ?? ''} />{/key}
    {:else if route.name === 'preview'}{#key route.params[0]}<PreviewPage gameId={route.params[0] ?? ''} />{/key}
    {:else}<GamesPage />
    {/if}
  </main>
{/if}
