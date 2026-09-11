<script lang="ts">
  // Pick a core Person — the child, or whoever is collecting them.
  //
  // School Pool stores ids, never names: the child on the week board is the
  // same record as the child on /people/[id], so a renamed person is renamed
  // everywhere and a pickup is attributable to a real contact.
  import Avatar from '$lib/Avatar.svelte';
  import Icon from '$lib/Icon.svelte';
  import { assetUrl } from '$lib/data/batch';
  import { personName, searchPeople } from '$lib/data/people';
  import type { Person } from '$lib/data/types';

  let {
    selected = null,
    label = '',
    placeholder = 'Search people…',
    allowClear = true,
    onpick
  }: {
    selected?: Person | null;
    label?: string;
    placeholder?: string;
    allowClear?: boolean;
    onpick: (person: Person | null) => void;
  } = $props();

  let open = $state(false);
  let q = $state('');
  let results = $state<Person[]>([]);
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function search(value: string) {
    q = value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      busy = true;
      try {
        results = (await searchPeople(value, 8)) as Person[];
      } catch {
        results = [];
      } finally {
        busy = false;
      }
    }, 180);
  }

  function choose(p: Person | null) {
    onpick(p);
    open = false;
    q = '';
    results = [];
  }
</script>

<div class="text-xs text-ink-500">
  {#if label}<div class="mb-1">{label}</div>{/if}

  {#if selected && !open}
    <div class="flex items-center gap-2 rounded-[10px] border border-surface-border px-2 py-1.5">
      <Avatar
        name={personName(selected)}
        src={assetUrl(selected.person_picture, { width: 48, height: 48, fit: 'cover' })}
        size={22}
      />
      <span class="min-w-0 flex-1 truncate text-sm text-ink-900">{personName(selected)}</span>
      <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" onclick={() => { open = true; void search(''); }}>
        Change
      </button>
      {#if allowClear}
        <button
          class="btn-ghost !min-h-0 !px-2 !py-1 text-tag-salesText"
          type="button"
          aria-label="Clear"
          onclick={() => choose(null)}
        >
          <Icon name="x" size={14} />
        </button>
      {/if}
    </div>
  {:else}
    <div class="relative">
      <input
        class="input"
        type="search"
        {placeholder}
        value={q}
        oninput={(e) => search((e.currentTarget as HTMLInputElement).value)}
        onfocus={() => { open = true; if (!results.length) void search(q); }}
      />
      {#if open}
        <div class="mt-1 max-h-64 overflow-auto rounded-[10px] border border-surface-border bg-surface-card">
          {#if busy}
            <div class="px-3 py-2 text-xs text-ink-400">Searching…</div>
          {:else if results.length === 0}
            <div class="px-3 py-2 text-xs text-ink-400">
              No match. People come from your contacts — add the child there first.
            </div>
          {:else}
            {#each results as person (person.id)}
              <button
                class="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-hover"
                type="button"
                onclick={() => choose(person)}
              >
                <Avatar
                  name={personName(person)}
                  src={assetUrl(person.person_picture, { width: 48, height: 48, fit: 'cover' })}
                  size={22}
                />
                <span class="min-w-0 flex-1 truncate text-sm text-ink-900">{personName(person)}</span>
              </button>
            {/each}
          {/if}
          {#if selected}
            <button class="w-full px-3 py-2 text-left text-xs text-ink-400 hover:bg-surface-hover" type="button" onclick={() => { open = false; }}>
              Keep {personName(selected)}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
