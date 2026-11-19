<script lang="ts">
  import type { Role } from '@ffs/core';
  import { listAppUsers, sendLoginLink, setUserRole, type AppUser } from '@ffs/data';
  import { app, ownTeam, refreshLists, signOut, store, supabase, syncNow } from '../lib/app.svelte';
  import { download } from '../lib/format';

  let email = $state('');
  let message = $state('');
  let users = $state<AppUser[]>([]);
  let teamName = $state(ownTeam()?.name ?? '');
  let theme = $state(localStorage.getItem('ffs.theme') ?? '');

  async function loadUsers() {
    if (supabase && app.user?.role === 'admin') {
      try { users = await listAppUsers(supabase); } catch (e) { message = String(e); }
    }
  }
  $effect(() => { void app.user?.id; void loadUsers(); });

  async function login() {
    try {
      await sendLoginLink(supabase!, email.trim(), location.origin + location.pathname);
      message = 'Login-Link wurde per E-Mail gesendet.';
    } catch (e) { message = e instanceof Error ? e.message : String(e); }
  }

  async function role(id: string, r: Role) {
    await setUserRole(supabase!, id, r);
    await loadUsers();
  }

  async function renameTeam() {
    const t = ownTeam();
    if (!t) return;
    await store.saveTeam(teamName, true, t.id);
    await refreshLists();
    void syncNow();
    message = 'Teamname gespeichert.';
  }

  async function backup() {
    download(`flagstats-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await store.exportAll(), null, 2), 'application/json');
  }
  async function restore(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await store.importAll(JSON.parse(await file.text()));
      await refreshLists();
      message = 'Backup eingespielt.';
      void syncNow();
    } catch (err) { message = `Backup konnte nicht gelesen werden: ${err instanceof Error ? err.message : err}`; }
  }

  function setTheme(v: string) {
    theme = v;
    if (v) { localStorage.setItem('ffs.theme', v); document.documentElement.dataset.theme = v; }
    else { localStorage.removeItem('ffs.theme'); delete document.documentElement.dataset.theme; }
  }
</script>

<h1>Einstellungen</h1>
{#if message}<div class="banner" role="status" style="margin-bottom:.75rem">{message}</div>{/if}

<div class="card">
  <h2 style="margin-top:0">Verbindung und Sicherung</h2>
  <p data-testid="sync-text">{app.sync.message}</p>
  {#if app.backendConfigured}
    <p>Angemeldet als <b>{app.user?.email ?? '–'}</b> ({app.user?.role}).</p>
    <div class="row"><button type="button" onclick={syncNow}>Jetzt synchronisieren</button><button type="button" onclick={signOut}>Abmelden</button></div>
  {:else}
    <div class="banner warn">Keine Server-Verbindung eingerichtet: Die App läuft vollständig lokal auf diesem Gerät. Live-Ticker, Mehrgeräte-Betrieb und Google-Sheets-Export sind nicht aktiv. Bitte regelmäßig ein Backup herunterladen.</div>
  {/if}
</div>

{#if app.backendConfigured && !app.user}
  <div class="card">
    <h2 style="margin-top:0">Anmelden</h2>
    <label class="field"><span>E-Mail</span><input type="email" bind:value={email} /></label>
    <button type="button" class="primary" onclick={login}>Login-Link senden</button>
  </div>
{/if}

{#if app.user?.role === 'admin'}
  <div class="card">
    <h2 style="margin-top:0">Team</h2>
    <label class="field"><span>Name unseres Teams</span><input bind:value={teamName} /></label>
    <button type="button" onclick={renameTeam}>Speichern</button>
  </div>
{/if}

{#if users.length}
  <div class="card table-wrap">
    <h2 style="margin-top:0">Benutzer</h2>
    <table>
      <thead><tr><th>E-Mail</th><th>Rolle</th></tr></thead>
      <tbody>
        {#each users as u (u.id)}
          <tr><td>{u.email}</td><td>
            <select value={u.role} onchange={(e) => role(u.id, (e.currentTarget as HTMLSelectElement).value as Role)} disabled={u.id === app.user?.id}>
              <option value="admin">Admin</option><option value="typist">Typist</option><option value="viewer">Viewer</option>
            </select></td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<div class="card">
  <h2 style="margin-top:0">Backup</h2>
  <div class="row">
    <button type="button" onclick={backup} data-testid="backup">Backup herunterladen (JSON)</button>
    <label class="btn" style="display:inline-flex;align-items:center">Backup einspielen<input type="file" accept="application/json,.json" hidden onchange={restore} /></label>
  </div>
</div>

<div class="card">
  <h2 style="margin-top:0">Darstellung</h2>
  <select value={theme} onchange={(e) => setTheme((e.currentTarget as HTMLSelectElement).value)} aria-label="Darstellung">
    <option value="">Automatisch</option><option value="light">Hell</option><option value="dark">Dunkel</option>
  </select>
  <p class="small muted">Tipp: Im Browser-Menü „Zum Startbildschirm hinzufügen“ wählen, dann startet die App wie eine native App und arbeitet auch offline.</p>
  <p class="small muted">Ereignisse offen: {app.sync.pending}</p>
</div>
