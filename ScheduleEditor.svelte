<script lang="ts">
  // The weekly timetable for one child: what repeats, on which weekday, at
  // what time, with what in the bag and who collects.
  //
  // Weekdays, not dates. Anything that happens once — a holiday, a trip, the
  // week the pool is closed — belongs in Special days, which overrides this.
  import Icon from '$lib/Icon.svelte';
  import { personName } from '$lib/data/people';
  import type { Person } from '$lib/data/types';
  import GearInput from '$lib/plugins/school-pool/GearInput.svelte';
  import PersonPicker from '$lib/plugins/school-pool/PersonPicker.svelte';
  import {
    createSlot,
    deleteSlot,
    updateSlot,
    type SchoolEnrollment,
    type SchoolSlot
  } from '$lib/plugins/school-pool/data';
  import {
    SLOT_KINDS,
    WEEKDAY_LABELS,
    formatTime,
    normalizeTime,
    slotKindLabel,
    toMinutes
  } from '$lib/plugins/school-pool/schedule';

  let {
    enrollment,
    slots = [],
    people = new Map<number, Person>(),
    gearSuggestions = [],
    writeAllowed = true,
    onchanged
  }: {
    enrollment: SchoolEnrollment;
    slots?: SchoolSlot[];
    people?: Map<number, Person>;
    gearSuggestions?: string[];
    writeAllowed?: boolean;
    onchanged: () => void | Promise<void>;
  } = $props();

  type Draft = {
    weekday: number;
    kind: string;
    title: string;
    start_time: string;
    end_time: string;
    location: string;
    responsible: Person | null;
    gear: string[];
    week_parity: string;
    effective_from: string;
    effective_to: string;
    note: string;
  };

  const blank = (weekday = 1): Draft => ({
    weekday,
    kind: 'class',
    title: '',
    start_time: '',
    end_time: '',
    location: '',
    responsible: null,
    gear: [],
    week_parity: 'every',
    effective_from: '',
    effective_to: '',
    note: ''
  });

  let editingId = $state<number | null>(null);
  let addingOn = $state<number | null>(null);
  let draft = $state<Draft>(blank());
  let busy = $state(false);
  let error = $state('');

  const mine = $derived(slots.filter((s) => s.enrollment_id === enrollment.id));

  const byDay = $derived(
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      rows: mine
        .filter((s) => s.weekday === weekday)
        .sort((a, b) => (toMinutes(a.start_time) ?? 1e9) - (toMinutes(b.start_time) ?? 1e9))
    }))
  );

  // The weekend only earns its rows once something is on it.
  const visibleDays = $derived(
    byDay.filter((d) => d.weekday <= 5 || d.rows.length > 0 || addingOn === d.weekday)
  );

  function startEdit(s: SchoolSlot) {
    editingId = s.id;
    addingOn = null;
    draft = {
      weekday: s.weekday ?? 1,
      kind: s.kind ?? 'class',
      title: s.title ?? '',
      start_time: formatTime(s.start_time),
      end_time: formatTime(s.end_time),
      location: s.location ?? '',
      responsible: s.responsible_person_id ? people.get(s.responsible_person_id) ?? null : null,
      gear: [...(s.gear ?? [])],
      week_parity: s.week_parity ?? 'every',
      effective_from: s.effective_from ?? '',
      effective_to: s.effective_to ?? '',
      note: s.note ?? ''
    };
  }

  function cancel() {
    editingId = null;
    addingOn = null;
    draft = blank();
  }

  function patchOf(d: Draft) {
    return {
      enrollment_id: enrollment.id,
      weekday: d.weekday,
      kind: d.kind,
      title: d.title.trim() || slotKindLabel(d.kind),
      start_time: normalizeTime(d.start_time),
      end_time: normalizeTime(d.end_time),
      location: d.location.trim() || null,
      responsible_person_id: d.responsible?.id ?? null,
      gear: d.gear,
      week_parity: d.week_parity,
      effective_from: d.effective_from || null,
      effective_to: d.effective_to || null,
      note: d.note.trim() || null
    };
  }

  async function save() {
    busy = true;
    error = '';
    try {
      if (editingId != null) await updateSlot(editingId, patchOf(draft));
      else await createSlot(patchOf(draft));
      cancel();
      await onchanged();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save this entry.';
    } finally {
      busy = false;
    }
  }

  async function remove(s: SchoolSlot) {
    if (!confirm(`Remove "${s.title ?? slotKindLabel(s.kind)}" from every ${WEEKDAY_LABELS[s.weekday ?? 1]}?`)) return;
    busy = true;
    try {
      await deleteSlot(s.id);
      await onchanged();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not remove this entry.';
    } finally {
      busy = false;
    }
  }
</script>

{#if error}
  <div class="mb-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">{error}</div>
{/if}

<div class="divide-y divide-surface-border">
  {#each visibleDays as day (day.weekday)}
    <div class="py-2">
      <div class="flex items-center justify-between px-1">
        <span class="muted-label">{WEEKDAY_LABELS[day.weekday]}</span>
        {#if writeAllowed}
          <button
            class="btn-ghost !min-h-0 !px-2 !py-1 text-xs"
            type="button"
            onclick={() => { editingId = null; addingOn = day.weekday; draft = blank(day.weekday); }}
          >
            <Icon name="plus" size={13} /> Add
          </button>
        {/if}
      </div>

      {#if day.rows.length === 0 && addingOn !== day.weekday}
        <p class="px-1 pb-1 text-xs text-ink-400">Nothing yet.</p>
      {/if}

      {#each day.rows as slot (slot.id)}
        {#if editingId === slot.id}
          <div class="mt-2 rounded-[10px] border border-surface-border p-3">{@render form()}</div>
        {:else}
          {@const who = slot.responsible_person_id ? people.get(slot.responsible_person_id) : null}
          <div class="flex items-start gap-3 px-1 py-1.5">
            <div class="w-24 shrink-0 text-xs tabular-nums text-ink-500">
              {formatTime(slot.start_time) || '—'}{#if slot.end_time}–{formatTime(slot.end_time)}{/if}
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm text-ink-900">
                {slot.title || slotKindLabel(slot.kind)}
                {#if slot.kind && slot.kind !== 'class' && (slot.title ?? '') !== slotKindLabel(slot.kind)}
                  <span class="tag ml-1.5">{slotKindLabel(slot.kind)}</span>
                {/if}
                {#if (slot.week_parity ?? 'every') !== 'every'}<span class="tag ml-1.5">{slot.week_parity} weeks</span>{/if}
              </div>
              <div class="text-xs text-ink-400">
                {[slot.location, who ? `with ${personName(who)}` : ''].filter(Boolean).join(' · ')}
              </div>
              {#if slot.gear?.length}
                <div class="mt-1 flex flex-wrap gap-1">
                  {#each slot.gear as g (g)}<span class="tag">{g}</span>{/each}
                </div>
              {/if}
            </div>
            {#if writeAllowed}
              <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" aria-label="Edit" onclick={() => startEdit(slot)}>
                <Icon name="pencil" size={14} />
              </button>
              <button
                class="btn-ghost !min-h-0 !px-2 !py-1 text-tag-salesText"
                type="button"
                aria-label="Remove"
                disabled={busy}
                onclick={() => void remove(slot)}
              >
                <Icon name="trash" size={14} />
              </button>
            {/if}
          </div>
        {/if}
      {/each}

      {#if addingOn === day.weekday}
        <div class="mt-2 rounded-[10px] border border-surface-border p-3">{@render form()}</div>
      {/if}
    </div>
  {/each}
</div>

{#snippet form()}
  <div class="grid gap-3 sm:grid-cols-2">
    <label class="text-xs text-ink-500">
      Weekday
      <select class="input mt-1" bind:value={draft.weekday}>
        {#each [1, 2, 3, 4, 5, 6, 7] as d (d)}
          <option value={d}>{WEEKDAY_LABELS[d]}</option>
        {/each}
      </select>
    </label>

    <label class="text-xs text-ink-500">
      Kind
      <select class="input mt-1" bind:value={draft.kind}>
        {#each SLOT_KINDS as k (k.value)}
          <option value={k.value}>{k.label}</option>
        {/each}
      </select>
    </label>

    <label class="text-xs text-ink-500 sm:col-span-2">
      What it is
      <input class="input mt-1" bind:value={draft.title} placeholder="Sund, Íþróttir, Pickup…" />
    </label>

    <label class="text-xs text-ink-500">
      Starts
      <input class="input mt-1" type="time" bind:value={draft.start_time} />
    </label>

    <label class="text-xs text-ink-500">
      Ends
      <input class="input mt-1" type="time" bind:value={draft.end_time} />
    </label>

    <label class="text-xs text-ink-500 sm:col-span-2">
      Where
      <input class="input mt-1" bind:value={draft.location} placeholder="Sundlaugin, the side gate…" />
    </label>

    {#if draft.kind === 'pickup' || draft.kind === 'dropoff'}
      <div class="sm:col-span-2">
        <PersonPicker
          label="Who does it (leave empty for the usual person)"
          selected={draft.responsible}
          onpick={(p) => (draft.responsible = p)}
        />
      </div>
    {/if}

    <div class="sm:col-span-2">
      <GearInput
        value={draft.gear}
        suggestions={gearSuggestions}
        label="What has to be in the bag"
        onchange={(next) => (draft.gear = next)}
      />
    </div>

    <label class="text-xs text-ink-500">
      Repeats
      <select class="input mt-1" bind:value={draft.week_parity}>
        <option value="every">Every week</option>
        <option value="odd">Odd weeks</option>
        <option value="even">Even weeks</option>
      </select>
    </label>

    <label class="text-xs text-ink-500">
      Note
      <input class="input mt-1" bind:value={draft.note} />
    </label>

    <label class="text-xs text-ink-500">
      From <span class="text-ink-300">(optional)</span>
      <input class="input mt-1" type="date" bind:value={draft.effective_from} />
    </label>

    <label class="text-xs text-ink-500">
      Until <span class="text-ink-300">(optional)</span>
      <input class="input mt-1" type="date" bind:value={draft.effective_to} />
    </label>
  </div>

  <div class="mt-3 flex justify-end gap-2">
    <button class="btn-ghost" type="button" onclick={cancel}>Cancel</button>
    <button class="btn-primary" type="button" disabled={busy} onclick={() => void save()}>
      {busy ? 'Saving…' : editingId != null ? 'Save entry' : 'Add entry'}
    </button>
  </div>
{/snippet}
