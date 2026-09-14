<script lang="ts">
  // The children you follow — one row per child per school.
  //
  // A child is a core Person, and the school is a core organization when you
  // have a record for it. Neither is copied here: this row is the link plus
  // the things only school makes true (class, teacher, who collects).
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import { assetUrl } from '$lib/data/batch';
  import { personName } from '$lib/data/people';
  import { searchOrgs } from '$lib/data/orgs';
  import type { Organization, Person } from '$lib/data/types';
  import PersonPicker from '$lib/plugins/school-pool/PersonPicker.svelte';
  import {
    createEnrollment,
    deleteEnrollment,
    updateEnrollment,
    type SchoolEnrollment
  } from '$lib/plugins/school-pool/data';

  let {
    enrollments = [],
    people = new Map<number, Person>(),
    orgs = new Map<number, Organization>(),
    writeAllowed = true,
    onchanged
  }: {
    enrollments?: SchoolEnrollment[];
    people?: Map<number, Person>;
    orgs?: Map<number, Organization>;
    writeAllowed?: boolean;
    onchanged: () => void | Promise<void>;
  } = $props();

  type Draft = {
    person: Person | null;
    school_name: string;
    organization_id: number | null;
    organization_label: string;
    class_label: string;
    teacher_name: string;
    pickup: Person | null;
    color: string;
    note: string;
  };

  const blank = (): Draft => ({
    person: null,
    school_name: '',
    organization_id: null,
    organization_label: '',
    class_label: '',
    teacher_name: '',
    pickup: null,
    color: '',
    note: ''
  });

  let adding = $state(false);
  let draft = $state<Draft>(blank());
  let editingId = $state<number | null>(null);
  let busy = $state(false);
  let error = $state('');

  // School lookup — optional. Typing a name is enough; linking the org record
  // is what lets two siblings at one school share one typed-in lunch menu even
  // if the names are spelled differently.
  let orgQuery = $state('');
  let orgResults = $state<Organization[]>([]);
  let orgTimer: ReturnType<typeof setTimeout> | null = null;

  function searchSchools(value: string) {
    orgQuery = value;
    if (orgTimer) clearTimeout(orgTimer);
    orgTimer = setTimeout(async () => {
      try {
        orgResults = value.trim() ? ((await searchOrgs(value, 6)) as Organization[]) : [];
      } catch {
        orgResults = [];
      }
    }, 200);
  }

  function startEdit(e: SchoolEnrollment) {
    editingId = e.id;
    adding = false;
    const org = e.organization_id ? orgs.get(e.organization_id) : null;
    draft = {
      person: e.person_id ? people.get(e.person_id) ?? null : null,
      school_name: e.school_name ?? '',
      organization_id: e.organization_id,
      organization_label: org?.name ?? '',
      class_label: e.class_label ?? '',
      teacher_name: e.teacher_name ?? '',
      pickup: e.pickup_person_id ? people.get(e.pickup_person_id) ?? null : null,
      color: e.color ?? '',
      note: e.note ?? ''
    };
  }

  function cancel() {
    adding = false;
    editingId = null;
    draft = blank();
    orgResults = [];
    orgQuery = '';
  }

  function patchOf(d: Draft) {
    return {
      person_id: d.person?.id ?? null,
      school_name: d.school_name.trim() || null,
      organization_id: d.organization_id,
      class_label: d.class_label.trim() || null,
      teacher_name: d.teacher_name.trim() || null,
      pickup_person_id: d.pickup?.id ?? null,
      color: d.color.trim() || null,
      note: d.note.trim() || null
    };
  }

  async function save() {
    if (!draft.person) {
      error = 'Pick the child first — School Pool hangs off your contacts.';
      return;
    }
    busy = true;
    error = '';
    try {
      if (editingId != null) await updateEnrollment(editingId, patchOf(draft));
      else await createEnrollment({ ...patchOf(draft), sort: enrollments.length });
      cancel();
      await onchanged();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the child.';
    } finally {
      busy = false;
    }
  }

  async function archive(e: SchoolEnrollment) {
    busy = true;
    try {
      await updateEnrollment(e.id, { status: (e.status ?? 'active') === 'archived' ? 'active' : 'archived' });
      await onchanged();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not archive.';
    } finally {
      busy = false;
    }
  }

  async function remove(e: SchoolEnrollment) {
    const who = e.person_id ? people.get(e.person_id) : null;
    const label = who ? personName(who) : 'this child';
    if (!confirm(`Delete ${label}'s schedule at ${e.school_name ?? 'this school'}? Their timetable and special days go with it. The contact record stays.`))
      return;
    busy = true;
    try {
      await deleteEnrollment(e.id);
      await onchanged();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Could not delete.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="card">
  <div class="card-header">
    <span class="card-title"><Icon name="users" size={16} /> Children</span>
    {#if writeAllowed && !adding && editingId == null}
      <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" onclick={() => { adding = true; draft = blank(); }}>
        <Icon name="plus" size={14} /> Add
      </button>
    {/if}
  </div>

  {#if error}
    <div class="mx-4 mb-2 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
      {error}
    </div>
  {/if}

  {#if enrollments.length === 0 && !adding}
    <p class="px-4 pb-4 text-sm text-ink-500">
      No children yet. Add one — pick the person from your contacts, then name the school and the class.
    </p>
  {:else}
    <div class="divide-y divide-surface-border">
      {#each enrollments as e (e.id)}
        {@const child = e.person_id ? people.get(e.person_id) : null}
        {@const collector = e.pickup_person_id ? people.get(e.pickup_person_id) : null}
        <div class="px-4 py-3">
          {#if editingId === e.id}
            {@render form()}
          {:else}
            <div class="flex items-center gap-3">
              <Avatar
                name={child ? personName(child) : '?'}
                src={assetUrl(child?.person_picture, { width: 64, height: 64, fit: 'cover' })}
                size={32}
              />
              <div class="min-w-0 flex-1">
                <div class="truncate font-semibold text-ink-900">
                  {child ? personName(child) : 'Unknown child'}
                  {#if (e.status ?? 'active') === 'archived'}<span class="tag ml-2">Archived</span>{/if}
                </div>
                <div class="truncate text-xs text-ink-500">
                  {[e.school_name, e.class_label, e.teacher_name].filter(Boolean).join(' · ') || 'No school set'}
                </div>
                {#if collector}
                  <div class="mt-0.5 text-xs text-ink-400">Usually collected by {personName(collector)}</div>
                {/if}
              </div>
              {#if writeAllowed}
                <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" aria-label="Edit" onclick={() => startEdit(e)}>
                  <Icon name="pencil" size={15} />
                </button>
                <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" onclick={() => void archive(e)}>
                  {(e.status ?? 'active') === 'archived' ? 'Restore' : 'Archive'}
                </button>
                <button
                  class="btn-ghost !min-h-0 !px-2 !py-1 text-tag-salesText"
                  type="button"
                  aria-label="Delete"
                  disabled={busy}
                  onclick={() => void remove(e)}
                >
                  <Icon name="trash" size={15} />
                </button>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#if adding}
    <div class="border-t border-surface-border px-4 py-3">{@render form()}</div>
  {/if}
</div>

{#snippet form()}
  <div class="grid gap-3 sm:grid-cols-2">
    <div class="sm:col-span-2">
      <PersonPicker
        label="Child (from your contacts)"
        selected={draft.person}
        onpick={(p) => (draft.person = p)}
      />
    </div>

    <label class="text-xs text-ink-500">
      School
      <input class="input mt-1" bind:value={draft.school_name} placeholder="Hverfisskólinn" />
    </label>

    <label class="text-xs text-ink-500">
      Class
      <input class="input mt-1" bind:value={draft.class_label} placeholder="3. bekkur" />
    </label>

    <div class="text-xs text-ink-500 sm:col-span-2">
      Link the school to an organization <span class="text-ink-300">(optional — shares one lunch menu between siblings)</span>
      {#if draft.organization_id}
        <div class="mt-1 flex items-center gap-2 rounded-[10px] border border-surface-border px-2 py-1.5">
          <Icon name="building" size={14} />
          <span class="min-w-0 flex-1 truncate text-sm text-ink-900">{draft.organization_label || `Organization #${draft.organization_id}`}</span>
          <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" onclick={() => { draft.organization_id = null; draft.organization_label = ''; }}>
            Unlink
          </button>
        </div>
      {:else}
        <input
          class="input mt-1"
          type="search"
          placeholder="Search organizations…"
          value={orgQuery}
          oninput={(e) => searchSchools((e.currentTarget as HTMLInputElement).value)}
        />
        {#if orgResults.length}
          <div class="mt-1 max-h-48 overflow-auto rounded-[10px] border border-surface-border">
            {#each orgResults as org (org.id)}
              <button
                class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                type="button"
                onclick={() => {
                  draft.organization_id = org.id;
                  draft.organization_label = org.name ?? '';
                  if (!draft.school_name.trim()) draft.school_name = org.name ?? '';
                  orgResults = [];
                  orgQuery = '';
                }}
              >
                <Icon name="building" size={14} /> {org.name}
              </button>
            {/each}
          </div>
        {/if}
      {/if}
    </div>

    <label class="text-xs text-ink-500">
      Teacher
      <input class="input mt-1" bind:value={draft.teacher_name} />
    </label>

    <label class="text-xs text-ink-500">
      Colour <span class="text-ink-300">(week board chip)</span>
      <input class="input mt-1 !py-1" type="color" bind:value={draft.color} />
    </label>

    <div class="sm:col-span-2">
      <PersonPicker
        label="Usually collected by"
        placeholder="Search people…"
        selected={draft.pickup}
        onpick={(p) => (draft.pickup = p)}
      />
    </div>

    <label class="text-xs text-ink-500 sm:col-span-2">
      Note
      <input class="input mt-1" bind:value={draft.note} placeholder="Allergies, the side gate, the after-school club code…" />
    </label>
  </div>

  <div class="mt-3 flex justify-end gap-2">
    <button class="btn-ghost" type="button" onclick={cancel}>Cancel</button>
    <button class="btn-primary" type="button" disabled={busy} onclick={() => void save()}>
      {busy ? 'Saving…' : editingId != null ? 'Save child' : 'Add child'}
    </button>
  </div>
{/snippet}
