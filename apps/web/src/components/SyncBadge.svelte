<script lang="ts">
  import { app } from '../lib/app.svelte';

  const labels: Record<string, string> = {
    synced: 'Saved',
    sending: 'Sending',
    offline: 'Offline',
    error: 'Error',
    sheets_pending: 'Saved, sheets pending',
    local_only: 'Local only'
  };
  let s = $derived(app.sync);
</script>

<span class="sync {s.state}" role="status" aria-live="polite" data-testid="sync-badge" data-state={s.state} title={s.message}>
  <span class="dot"></span>
  <span>{labels[s.state] ?? s.state}{s.pending ? ` (${s.pending})` : ''}</span>
</span>
