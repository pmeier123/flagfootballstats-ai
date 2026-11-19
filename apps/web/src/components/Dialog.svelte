<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, onclose, children }: { title?: string; onclose: () => void; children: Snippet } = $props();

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window onkeydown={key} />
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="dialog-backdrop" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
    {#if title}<h2 style="margin-top:0">{title}</h2>{/if}
    {@render children()}
  </div>
</div>
