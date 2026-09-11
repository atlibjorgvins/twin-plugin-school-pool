<script lang="ts">
  // The canteen menu for one school week, typed in by hand — the sheet comes
  // home on paper or in an email, and this is where it stops being paper.
  //
  // Keyed on the SCHOOL, not the child: siblings at one school share the row,
  // so the week is entered once however many children read it.
  import Icon from '$lib/Icon.svelte';
  import {
    saveMenuCell,
    type MenuDraft,
    type SchoolMenuEntry
  } from '$lib/plugins/school-pool/data';
  import { formatDayLabel, menuKey, weekDates, type SchoolRef } from '$lib/plugins/school-pool/schedule';

  let {
    schools = [],
    mondayISO,
    menu = [],
    writeAllowed = true,
    onchanged
  }: {
    schools?: SchoolRef[];
    mondayISO: string;
    menu?: SchoolMenuEntry[];
    writeAllowed?: boolean;
    onchanged: () => void | Promise<void>;
  } = $props();

  let activeKey = $state<string>('');
  let rows = $state<Record<string, { main: string; side: string; note: string }>>({});
  let busy = $state(false);
  let saved = $state(false);
  let error = $state('');

  const school = $derived(schools.find((s) => s.key === activeKey) ?? schools[0] ?? null);
  const dates = $derived(weekDates(mondayISO, 5)); // canteen weeks are Mon–Fri

  function existingFor(dateISO: string): SchoolMenuEntry | null {
    if (!school) return null;
    return (
      menu.find(
        (m) => m.date === dateISO && menuKey(m.organization_id, m.school_name) === school.key && (m.meal ?? 'lunch') === 'lunch'
      ) ?? null
    );
  }

  // Re-seed the form whenever the week or the school changes. Anything half
  // typed and unsaved is dropped on that switch — deliberately: a draft that
  // survives a week change would silently write Monday's soup onto the wrong
  // Monday.
  //
  // `seededFor` is why the confirmation survives: saving reloads the menu,
  // which re-runs this effect, which used to clear "Saved." a blink after it
  // appeared. Only an actual change of week or school resets it.
  let seededFor = $state('');

  $effect(() => {
    const key = school?.key ?? '';
    const week = mondayISO;
    const seeded: Record<string, { main: string; side: string; note: string }> = {};
    for (const d of weekDates(week, 5)) {
      const row = key
        ? menu.find(
            (m) => m.date === d && menuKey(m.organization_id, m.school_name) === key && (m.meal ?? 'lunch') === 'lunch'
          )
        : null;
      seeded[d] = { main: row?.main ?? '', side: row?.side ?? '', note: row?.note ?? '' };
    }
    rows = seeded;
    const signature = `${key}|${week}`;
    if (seededFor !== signature) {
      saved = false;
      seededFor = signature;
    }
  });

  async function saveWeek() {
    if (!school) return;
    busy = true;
    error = '';
    try {
      for (const d of dates) {
        const draft: MenuDraft = {
          organization_id: school.organization_id,
          school_name: school.school_name,
          date: d,
          meal: 'lunch',
          main: rows[d]?.main ?? '',
          side: rows[d]?.side ?? '',
          note: rows[d]?.note ?? ''
        };
        const existing = existingFor(d);
        const unchanged =
          (existing?.main ?? '') === draft.main.trim() &&
          (existing?.side ?? '') === draft.side.trim() &&
          (existing?.note ?? '') === draft.note.trim();
        if (unchanged) continue;
        await saveMenuCell(draft, existing);
      }
      saved = true;
      await onchanged();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the menu.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="utensils" size={16} /> Lunch menu</span>
    {#if schools.length > 1}
      <div class="flex flex-wrap gap-1">
        {#each schools as s (s.key)}
          <button
            class="chip-radio"
            class:is-selected={(school?.key ?? '') === s.key}
            type="button"
            onclick={() => (activeKey = s.key)}
          >
            {s.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if error}
    <div class="mx-4 mb-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">{error}</div>
  {/if}

  {#if !school}
    <p class="px-4 pb-4 text-sm text-ink-500">Add a child with a school first — the menu is stored per school.</p>
  {:else}
    <div class="px-4 pb-4">
      <p class="mb-3 text-xs text-ink-400">
        {school.label} · week of {formatDayLabel(mondayISO)}. Leave a day blank when there is no menu; clearing a filled
        day deletes it.
      </p>

      <div class="space-y-2">
        {#each dates as d (d)}
          {#if rows[d]}
          <div class="grid gap-2 sm:grid-cols-[6rem_1fr_1fr]">
            <div class="pt-2 text-xs tabular-nums text-ink-500">{formatDayLabel(d)}</div>
            <input
              class="input !min-h-0 !py-2"
              placeholder="Main"
              disabled={!writeAllowed}
              bind:value={rows[d].main}
            />
            <input
              class="input !min-h-0 !py-2"
              placeholder="Side / vegetarian"
              disabled={!writeAllowed}
              bind:value={rows[d].side}
            />
          </div>
          {/if}
        {/each}
      </div>

      {#if writeAllowed}
        <div class="mt-4 flex items-center justify-end gap-3">
          {#if saved}<span class="text-xs text-ink-400">Saved.</span>{/if}
          <button class="btn-primary" type="button" disabled={busy} onclick={() => void saveWeek()}>
            {busy ? 'Saving…' : 'Save week'}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</div>
