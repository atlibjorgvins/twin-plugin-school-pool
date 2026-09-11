<script lang="ts">
  // What goes in the bag. Chips from the plugin setting for the five things
  // that recur, free text for everything else — a school that asks for "a
  // white t-shirt, no logo" once a year should not need a settings change.
  import Icon from '$lib/Icon.svelte';
  import { normalizeGear } from '$lib/plugins/school-pool/schedule';

  let {
    value = [],
    suggestions = [],
    label = 'Kit',
    onchange
  }: {
    value?: string[];
    suggestions?: string[];
    label?: string;
    onchange: (next: string[]) => void;
  } = $props();

  let draft = $state('');

  const unused = $derived(
    suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()))
  );

  function add(tag: string) {
    const next = normalizeGear([...value, tag]);
    draft = '';
    onchange(next);
  }

  function remove(tag: string) {
    onchange(value.filter((v) => v !== tag));
  }
</script>

<div class="text-xs text-ink-500">
  <div class="mb-1">{label}</div>
  {#if value.length}
    <div class="mb-1.5 flex flex-wrap gap-1">
      {#each value as tag (tag)}
        <span class="tag">
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onclick={() => remove(tag)}>
            <Icon name="x" size={12} />
          </button>
        </span>
      {/each}
    </div>
  {/if}
  <div class="flex gap-2">
    <input
      class="input !min-h-0 !py-1.5 flex-1"
      placeholder="Add kit…"
      bind:value={draft}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (draft.trim()) add(draft);
        }
      }}
    />
    <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" disabled={!draft.trim()} onclick={() => add(draft)}>
      <Icon name="plus" size={14} />
    </button>
  </div>
  {#if unused.length}
    <div class="mt-1.5 flex flex-wrap gap-1">
      {#each unused as tag (tag)}
        <button class="chip-radio" type="button" onclick={() => add(tag)}>+ {tag}</button>
      {/each}
    </div>
  {/if}
</div>
