<script lang="ts">
  // The dates that break the pattern: holidays, teacher days, short days,
  // trips, the afternoon someone else collects.
  //
  // A row with no child named applies to every child — which is what a national
  // holiday actually is, and saves entering it twice.
  import Icon from '$lib/Icon.svelte';
  import { personName } from '$lib/data/people';
  import type { Person } from '$lib/data/types';
  import GearInput from '$lib/plugins/school-pool/GearInput.svelte';
  import PersonPicker from '$lib/plugins/school-pool/PersonPicker.svelte';
  import {
    createDay,
    deleteDay,
    updateDay,
    type SchoolDay,
    type SchoolEnrollment
  } from '$lib/plugins/school-pool/data';
  import {
    DAY_KINDS,
    dayKindLabel,
    formatDayLabel,
    formatTime,
    kindCancels,
    normalizeTime,
    todayISO
  } from '$lib/plugins/school-pool/schedule';

  let {
    days = [],
    enrollments = [],
    people = new Map<number, Person>(),
    gearSuggestions = [],
    writeAllowed = true,
    onchanged
  }: {
    days?: SchoolDay[];
    enrollments?: SchoolEnrollment[];
    people?: Map<number, Person>;
    gearSuggestions?: string[];
    writeAllowed?: boolean;
    onchanged: () => void | Promise<void>;
  } = $props();

  type Draft = {
    enrollment_id: number | null;
    date: string;
    kind: string;
    title: string;
    start_time: string;
    end_time: string;
    location: string;
    gear: string[];
    pickup: Person | null;
    cancels_classes: boolean;
    note: string;
  };

  const blank = (): Draft => ({
    enrollment_id: null,
    date: todayISO(),
    kind: 'special',
    title: '',
    start_time: '',
    end_time: '',
    location: '',
    gear: [],
    pickup: null,
    cancels_classes: false,
    note: ''
  });

  let adding = $state(false);
  let editingId = $state<number | null>(null);
  let draft = $state<Draft>(blank());
  let showPast = $state(false);
  let busy = $state(false);
  let error = $state('');

  const today = todayISO();
  const sorted = $derived([...days].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')));
  const upcoming = $derived(sorted.filter((d) => (d.date ?? '') >= today));
  const past = $derived(sorted.filter((d) => (d.date ?? '') < today).reverse());
  const shown = $derived(showPast ? past : upcoming);

  function childLabel(id: number | null): string {
    if (id == null) return 'All children';
    const e = enrollments.find((x) => x.id === id);
    if (!e) return 'Child';
    const p = e.person_id ? people.get(e.person_id) : null;
    return p ? personName(p) : e.school_name ?? 'Child';
  }

  function startEdit(d: SchoolDay) {
    editingId = d.id;
    adding = false;
    draft = {
      enrollment_id: d.enrollment_id,
      date: d.date ?? today,
      kind: d.kind ?? 'special',
      title: d.title ?? '',
      start_time: formatTime(d.start_time),
      end_time: formatTime(d.end_time),
      location: d.location ?? '',
      gear: [...(d.gear ?? [])],
      pickup: d.pickup_person_id ? people.get(d.pickup_person_id) ?? null : null,
      cancels_classes: d.cancels_classes === true,
      note: d.note ?? ''
    };
  }

  function cancel() {
    adding = false;
    editingId = null;
    draft = blank();
  }

  // Changing the kind re-guesses the closure flag, because "Holiday" almost
  // always closes the school and "Trip" almost never does — but the guess is
  // only a default; the checkbox below it wins.
  function pickKind(kind: string) {
    draft.kind = kind;
    draft.cancels_classes = kindCancels(kind);
  }

  function patchOf(d: Draft) {
    return {
      enrollment_id: d.enrollment_id,
      date: d.date,
      kind: d.kind,
      title: d.title.trim() || dayKindLabel(d.kind),
      start_time: normalizeTime(d.start_time),
      end_time: normalizeTime(d.end_time),
      location: d.location.trim() || null,
      gear: d.gear,
      pickup_person_id: d.pickup?.id ?? null,
      cancels_classes: d.cancels_classes,
      note: d.note.trim() || null
    };
  }

  async function save() {
    if (!draft.date) {
      error = 'A special day needs a date.';
      return;
    }
    busy = true;
    error = '';
    try {
      if (editingId != null) await updateDay(editingId, patchOf(draft));
      else await createDay(patchOf(draft));
      cancel();
      await onchanged();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save this day.';
    } finally {
      busy = false;
    }
  }

  async function remove(d: SchoolDay) {
    if (!confirm(`Delete "${d.title ?? dayKindLabel(d.kind)}" on ${d.date}?`)) return;
    busy = true;
    try {
      await deleteDay(d.id);
      await onchanged();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not delete this day.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="calendar" size={16} /> Special days</span>
    <div class="flex items-center gap-1">
      <button class="chip-radio" class:is-selected={!showPast} type="button" onclick={() => (showPast = false)}>
        Upcoming
      </button>
      <button class="chip-radio" class:is-selected={showPast} type="button" onclick={() => (showPast = true)}>
        Past
      </button>
      {#if writeAllowed}
        <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" onclick={() => { adding = true; editingId = null; draft = blank(); }}>
          <Icon name="plus" size={14} /> Add
        </button>
      {/if}
    </div>
  </div>

  {#if error}
    <div class="mx-4 mb-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">{error}</div>
  {/if}

  {#if adding}
    <div class="border-b border-surface-border px-4 py-3">{@render form()}</div>
  {/if}

  {#if shown.length === 0}
    <p class="px-4 pb-4 text-sm text-ink-500">
      {showPast ? 'Nothing in the past.' : 'No special days ahead. Holidays, teacher days, trips and one-off pickups go here — they override the weekly timetable.'}
    </p>
  {:else}
    <div class="divide-y divide-surface-border">
      {#each shown as day (day.id)}
        <div class="px-4 py-3">
          {#if editingId === day.id}
            {@render form()}
          {:else}
            {@const who = day.pickup_person_id ? people.get(day.pickup_person_id) : null}
            <div class="flex items-start gap-3">
              <div class="w-24 shrink-0 text-xs tabular-nums text-ink-500">{formatDayLabel(day.date ?? '')}</div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm text-ink-900">
                  {day.title || dayKindLabel(day.kind)}
                  <span class="tag ml-1.5">{dayKindLabel(day.kind)}</span>
                  {#if day.cancels_classes}<span class="tag ml-1">No classes</span>{/if}
                </div>
                <div class="text-xs text-ink-400">
                  {[
                    childLabel(day.enrollment_id),
                    formatTime(day.start_time),
                    day.location,
                    who ? `collected by ${personName(who)}` : ''
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                {#if day.gear?.length}
                  <div class="mt-1 flex flex-wrap gap-1">{#each day.gear as g (g)}<span class="tag">{g}</span>{/each}</div>
                {/if}
                {#if day.note}<div class="mt-1 text-xs text-ink-500">{day.note}</div>{/if}
              </div>
              {#if writeAllowed}
                <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" aria-label="Edit" onclick={() => startEdit(day)}>
                  <Icon name="pencil" size={14} />
                </button>
                <button
                  class="btn-ghost !min-h-0 !px-2 !py-1 text-tag-salesText"
                  type="button"
                  aria-label="Delete"
                  disabled={busy}
                  onclick={() => void remove(day)}
                >
                  <Icon name="trash" size={14} />
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

{#snippet form()}
  <div class="grid gap-3 sm:grid-cols-2">
    <label class="text-xs text-ink-500">
      Date
      <input class="input mt-1" type="date" bind:value={draft.date} />
    </label>

    <label class="text-xs text-ink-500">
      Who it affects
      <select class="input mt-1" bind:value={draft.enrollment_id}>
        <option value={null}>All children</option>
        {#each enrollments as e (e.id)}
          <option value={e.id}>{childLabel(e.id)} · {e.school_name ?? ''}</option>
        {/each}
      </select>
    </label>

    <label class="text-xs text-ink-500">
      Kind
      <select class="input mt-1" value={draft.kind} onchange={(e) => pickKind((e.currentTarget as HTMLSelectElement).value)}>
        {#each DAY_KINDS as k (k.value)}
          <option value={k.value}>{k.label}</option>
        {/each}
      </select>
    </label>

    <label class="text-xs text-ink-500">
      What it is
      <input class="input mt-1" bind:value={draft.title} placeholder="Starfsdagur, vettvangsferð…" />
    </label>

    <label class="text-xs text-ink-500">
      Starts <span class="text-ink-300">(optional)</span>
      <input class="input mt-1" type="time" bind:value={draft.start_time} />
    </label>

    <label class="text-xs text-ink-500">
      Ends <span class="text-ink-300">(optional)</span>
      <input class="input mt-1" type="time" bind:value={draft.end_time} />
    </label>

    <label class="text-xs text-ink-500 sm:col-span-2">
      Where
      <input class="input mt-1" bind:value={draft.location} placeholder="Somewhere other than school" />
    </label>

    <div class="sm:col-span-2">
      <GearInput value={draft.gear} suggestions={gearSuggestions} label="Extra kit this day needs" onchange={(next) => (draft.gear = next)} />
    </div>

    <div class="sm:col-span-2">
      <PersonPicker label="Collected by, this day only" selected={draft.pickup} onpick={(p) => (draft.pickup = p)} />
    </div>

    <label class="flex items-center gap-2 text-xs text-ink-500 sm:col-span-2">
      <input type="checkbox" bind:checked={draft.cancels_classes} />
      No classes — the weekly timetable does not run
    </label>

    <label class="text-xs text-ink-500 sm:col-span-2">
      Note
      <input class="input mt-1" bind:value={draft.note} />
    </label>
  </div>

  <div class="mt-3 flex justify-end gap-2">
    <button class="btn-ghost" type="button" onclick={cancel}>Cancel</button>
    <button class="btn-primary" type="button" disabled={busy} onclick={() => void save()}>
      {busy ? 'Saving…' : editingId != null ? 'Save day' : 'Add day'}
    </button>
  </div>
{/snippet}
