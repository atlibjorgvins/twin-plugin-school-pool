<script lang="ts">
  // School Pool — the school week for the children in your contacts.
  //
  // The page answers one question first, at the top, before any navigation:
  // what happens today (or, after the pack-ahead hour, tomorrow), who collects,
  // what goes in the bag, and what is for lunch. Everything else — the week
  // board, the timetable, special days, the menu sheet — is a tab below it,
  // because those are things you maintain, not things you check at 07:40.
  import { onMount } from 'svelte';
  import Icon from '$lib/Icon.svelte';
  import Avatar from '$lib/Avatar.svelte';
  import { assetUrl } from '$lib/data/batch';
  import { canWrite } from '$lib/data/repo/vaultRole';
  import { getPeopleByIds, personName } from '$lib/data/people';
  import { getOrgsByIds } from '$lib/data/orgs';
  import type { Organization, Person } from '$lib/data/types';
  import { getPluginSetting } from '$lib/plugins/settings';
  import ChildrenEditor from '$lib/plugins/school-pool/ChildrenEditor.svelte';
  import ScheduleEditor from '$lib/plugins/school-pool/ScheduleEditor.svelte';
  import SpecialDaysEditor from '$lib/plugins/school-pool/SpecialDaysEditor.svelte';
  import MenuEditor from '$lib/plugins/school-pool/MenuEditor.svelte';
  import {
    listDays,
    listEnrollments,
    listMenu,
    listSlots,
    type SchoolDay,
    type SchoolEnrollment,
    type SchoolMenuEntry,
    type SchoolSlot
  } from '$lib/plugins/school-pool/data';
  import {
    addDays,
    dayHasContent,
    dayKindLabel,
    formatDayLabel,
    parseGearTags,
    planDate,
    planWeek,
    schoolsOf,
    slotKindLabel,
    startOfWeek,
    todayISO,
    type ChildDay
  } from '$lib/plugins/school-pool/schedule';

  type Tab = 'week' | 'timetable' | 'days' | 'menu';

  const writeAllowed = canWrite();
  const gearSuggestions = parseGearTags(
    getPluginSetting('school-pool', 'gearTags', 'Swim kit, Gym kit, Outdoor clothes, Library book, Packed lunch')
  );
  const packAheadAt = Number(getPluginSetting('school-pool', 'packAheadAt', '16')) || 0;

  const today = todayISO();
  const tomorrow = addDays(today, 1);
  // After the pack-ahead hour the bag is being packed for tomorrow, so
  // tomorrow leads. Before it, today does. Both are always rendered.
  const leadTomorrow = packAheadAt > 0 && new Date().getHours() >= packAheadAt;

  let tab = $state<Tab>('week');
  let weekStart = $state(startOfWeek(today));
  let enrollments = $state<SchoolEnrollment[]>([]);
  let slots = $state<SchoolSlot[]>([]);
  let days = $state<SchoolDay[]>([]);
  let weekMenu = $state<SchoolMenuEntry[]>([]);
  let todayMenu = $state<SchoolMenuEntry[]>([]);
  let people = $state(new Map<number, Person>());
  let orgs = $state(new Map<number, Organization>());
  let selectedChild = $state<number | null>(null); // null = all children
  let loaded = $state(false);
  let error = $state('');

  const activeEnrollments = $derived(
    enrollments.filter((e) => (e.status ?? 'active') !== 'archived')
  );
  const shownEnrollments = $derived(
    selectedChild == null ? activeEnrollments : activeEnrollments.filter((e) => e.id === selectedChild)
  );
  const schools = $derived(schoolsOf(activeEnrollments));

  const planInput = $derived({ slots, days, menu: weekMenu });
  const todayInput = $derived({ slots, days, menu: todayMenu });

  const board = $derived(planWeek(shownEnrollments, weekStart, planInput, 7));
  const todayPlan = $derived(planDate(shownEnrollments, today, todayInput));
  const tomorrowPlan = $derived(planDate(shownEnrollments, tomorrow, todayInput));

  const visibleBoard = $derived(
    board.filter((d, i) => i < 5 || d.children.some((c) => dayHasContent(c)))
  );

  function childName(e: SchoolEnrollment): string {
    const p = e.person_id ? people.get(e.person_id) : null;
    return p ? personName(p) : e.school_name ?? 'Child';
  }

  function childPhoto(e: SchoolEnrollment): string {
    const p = e.person_id ? people.get(e.person_id) : null;
    return assetUrl(p?.person_picture, { width: 64, height: 64, fit: 'cover' });
  }

  function whoIs(id: number | null): string {
    if (id == null) return '';
    const p = people.get(id);
    return p ? personName(p) : '';
  }

  async function loadPeopleAndOrgs(
    es: SchoolEnrollment[],
    ss: SchoolSlot[],
    ds: SchoolDay[]
  ) {
    const personIds = [
      ...es.flatMap((e) => [e.person_id, e.pickup_person_id]),
      ...ss.map((s) => s.responsible_person_id),
      ...ds.map((d) => d.pickup_person_id)
    ].filter((n): n is number => typeof n === 'number');
    const orgIds = es.map((e) => e.organization_id).filter((n): n is number => typeof n === 'number');

    const [ps, os] = await Promise.all([
      personIds.length ? getPeopleByIds(personIds) : Promise.resolve([] as Person[]),
      orgIds.length ? getOrgsByIds(orgIds) : Promise.resolve([] as Organization[])
    ]);
    people = new Map(ps.map((p) => [p.id, p]));
    orgs = new Map(os.map((o) => [o.id, o]));
  }

  /** Everything the page needs for the currently viewed week. One entry point
   *  so an edit in any tab refreshes every other one. */
  async function refresh() {
    error = '';
    try {
      const es = await listEnrollments(true);
      const ids = es.map((e) => e.id);
      const from = addDays(weekStart < today ? weekStart : today, -90);
      const to = addDays(weekStart > today ? weekStart : today, 365);
      const currentWeek = startOfWeek(today);

      const [ss, ds, wm, tm] = await Promise.all([
        listSlots(ids),
        listDays(from, to),
        listMenu(weekStart, addDays(weekStart, 6)),
        weekStart === currentWeek
          ? Promise.resolve([] as SchoolMenuEntry[])
          : listMenu(currentWeek, addDays(currentWeek, 6))
      ]);

      enrollments = es;
      slots = ss;
      days = ds;
      weekMenu = wm;
      todayMenu = weekStart === currentWeek ? wm : tm;
      await loadPeopleAndOrgs(es, ss, ds);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not load School Pool.';
    } finally {
      loaded = true;
    }
  }

  function gotoWeek(delta: number) {
    weekStart = addDays(weekStart, delta * 7);
    void refresh();
  }

  onMount(() => {
    void refresh();
  });
</script>

<svelte:head><title>School Pool · Tools</title></svelte:head>

<section class="space-y-5">
  <header class="flex items-start gap-3">
    <a href="/tools" class="btn-ghost !px-2" aria-label="Back to tools">
      <Icon name="chevron-left" size={20} />
    </a>
    <div class="min-w-0">
      <div class="hero-eyebrow">Day</div>
      <h1 class="font-display text-2xl font-bold sm:text-3xl" style="letter-spacing: -0.03em;">School Pool</h1>
      <p class="mt-1 text-sm text-ink-500">
        The school week for the children in your contacts — timetable, pickups, special days, kit and lunch.
      </p>
    </div>
  </header>

  {#if error}
    <div class="rounded-[12px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div>
  {/if}

  {#if !loaded}
    <div class="card p-4 text-sm text-ink-500">Loading the school week…</div>
  {:else if activeEnrollments.length === 0}
    <div class="card p-4">
      <div class="card-title mb-1"><Icon name="school" size={16} /> No children yet</div>
      <p class="text-sm text-ink-500">
        School Pool hangs off your contacts: add a child below by picking their person record, name the school and the
        class, then build the weekly timetable.
      </p>
    </div>
    <ChildrenEditor {enrollments} {people} {orgs} {writeAllowed} onchanged={refresh} />
  {:else}
    <!-- Child filter. One child is the common case on a phone; "All" is the
         household view and stays the default. -->
    {#if activeEnrollments.length > 1}
      <div class="flex flex-wrap gap-1">
        <button class="chip-radio" class:is-selected={selectedChild == null} type="button" onclick={() => (selectedChild = null)}>
          All children
        </button>
        {#each activeEnrollments as e (e.id)}
          <button class="chip-radio" class:is-selected={selectedChild === e.id} type="button" onclick={() => (selectedChild = e.id)}>
            {childName(e)}
          </button>
        {/each}
      </div>
    {/if}

    <!-- ── The panel this tool exists for ─────────────────────────────── -->
    <div class="grid gap-3 sm:grid-cols-2">
      {#if leadTomorrow}
        {@render dayPanel('Pack for tomorrow', tomorrow, tomorrowPlan)}
        {@render dayPanel('Today', today, todayPlan)}
      {:else}
        {@render dayPanel('Today', today, todayPlan)}
        {@render dayPanel('Tomorrow', tomorrow, tomorrowPlan)}
      {/if}
    </div>

    <!-- ── Tabs ───────────────────────────────────────────────────────── -->
    <div class="flex flex-wrap gap-1">
      {#each [['week', 'Week'], ['timetable', 'Timetable'], ['days', 'Special days'], ['menu', 'Menu']] as [key, label] (key)}
        <button class="chip-radio" class:is-selected={tab === key} type="button" onclick={() => (tab = key as Tab)}>
          {label}
        </button>
      {/each}
    </div>

    {#if tab === 'week'}
      <div class="card">
        <div class="card-header">
          <span class="card-title"><Icon name="calendar" size={16} /> Week of {formatDayLabel(weekStart)}</span>
          <div class="flex items-center gap-1">
            <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" aria-label="Previous week" onclick={() => gotoWeek(-1)}>
              <Icon name="chevron-left" size={16} />
            </button>
            <button class="btn-ghost !min-h-0 !px-2 !py-1 text-xs" type="button" onclick={() => { weekStart = startOfWeek(today); void refresh(); }}>
              This week
            </button>
            <button class="btn-ghost !min-h-0 !px-2 !py-1" type="button" aria-label="Next week" onclick={() => gotoWeek(1)}>
              <Icon name="chevron-right" size={16} />
            </button>
          </div>
        </div>

        <div class="divide-y divide-surface-border">
          {#each visibleBoard as column (column.date)}
            <div class="px-4 py-3" class:bg-surface-hover={column.date === today}>
              <div class="mb-2 flex items-baseline gap-2">
                <span class="muted-label">{formatDayLabel(column.date)}</span>
                {#if column.date === today}<span class="tag">Today</span>{/if}
              </div>

              <div class="grid gap-3 sm:grid-cols-2">
                {#each column.children as child (child.enrollment.id)}
                  <div class="rounded-[10px] border border-surface-border p-3">
                    <div class="mb-1.5 flex items-center gap-2">
                      <Avatar name={childName(child.enrollment)} src={childPhoto(child.enrollment)} size={20} />
                      <span class="truncate text-sm font-semibold text-ink-900">{childName(child.enrollment)}</span>
                      {#if child.closed}<span class="tag ml-auto">No school</span>{/if}
                    </div>
                    {@render childBody(child)}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>
    {:else if tab === 'timetable'}
      <ChildrenEditor {enrollments} {people} {orgs} {writeAllowed} onchanged={refresh} />
      {#each shownEnrollments as e (e.id)}
        <div class="card">
          <div class="card-header">
            <span class="card-title">
              <Avatar name={childName(e)} src={childPhoto(e)} size={20} />
              {childName(e)}
            </span>
            <span class="text-xs text-ink-400">{[e.school_name, e.class_label].filter(Boolean).join(' · ')}</span>
          </div>
          <div class="px-4 pb-3">
            <ScheduleEditor
              enrollment={e}
              {slots}
              {people}
              {gearSuggestions}
              {writeAllowed}
              onchanged={refresh}
            />
          </div>
        </div>
      {/each}
    {:else if tab === 'days'}
      <SpecialDaysEditor
        {days}
        enrollments={activeEnrollments}
        {people}
        {gearSuggestions}
        {writeAllowed}
        onchanged={refresh}
      />
    {:else}
      <MenuEditor {schools} mondayISO={weekStart} menu={weekMenu} {writeAllowed} onchanged={refresh} />
      <p class="px-1 text-xs text-ink-400">
        Showing the week of {formatDayLabel(weekStart)} — change it with the arrows on the Week tab.
      </p>
    {/if}
  {/if}
</section>

<!-- One child's day: the entries, who collects, the bag, the lunch. Shared by
     the Today/Tomorrow panels and the week board so they can never disagree. -->
{#snippet childBody(child: ChildDay)}
  {#if child.notices.length}
    <div class="mb-1.5 flex flex-wrap gap-1">
      {#each child.notices as n (n.id)}
        <span class="tag">{n.title || dayKindLabel(n.kind)}</span>
      {/each}
    </div>
  {/if}

  {#if child.entries.length === 0}
    <p class="text-xs text-ink-400">
      {child.closed ? 'No classes — nothing else booked.' : 'Nothing on the timetable for this day.'}
    </p>
  {:else}
    <div class="space-y-1">
      {#each child.entries as entry (entry.key)}
        <div class="flex items-baseline gap-2 text-sm">
          <span class="w-20 shrink-0 text-xs tabular-nums text-ink-500">{entry.start || '—'}</span>
          <span class="min-w-0 flex-1">
            <span class="text-ink-900">{entry.title}</span>
            <!-- The kind chip earns its place only when it says something the
                 title does not: "Pickup / Pickup" is noise on every row. -->
            {#if (entry.kind === 'pickup' || entry.kind === 'dropoff') && entry.title !== slotKindLabel(entry.kind)}
              <span class="tag ml-1">{slotKindLabel(entry.kind)}</span>
            {/if}
            {#if entry.location}<span class="text-xs text-ink-400"> · {entry.location}</span>{/if}
            {#if entry.personId}<span class="text-xs text-ink-400"> · {whoIs(entry.personId)}</span>{/if}
          </span>
        </div>
      {/each}
    </div>
  {/if}

  {#if child.pickup}
    <div class="mt-2 rounded-[8px] bg-surface-hover px-2 py-1.5 text-xs text-ink-500">
      <Icon name="clock" size={12} /> Pickup {child.pickup.start || 'time not set'}
      {#if child.pickup.location}· {child.pickup.location}{/if}
      {#if child.pickup.personId}· {whoIs(child.pickup.personId)}{/if}
    </div>
  {/if}

  {#if child.gear.length}
    <div class="mt-2">
      <div class="muted-label mb-1">In the bag</div>
      <div class="flex flex-wrap gap-1">
        {#each child.gear as g (g)}<span class="tag">{g}</span>{/each}
      </div>
    </div>
  {/if}

  {#if child.menu}
    <div class="mt-2 text-xs text-ink-500">
      <Icon name="utensils" size={12} />
      {[child.menu.main, child.menu.side].filter(Boolean).join(' · ')}
    </div>
  {:else if !child.closed}
    <div class="mt-2 text-xs text-ink-300">No lunch menu entered for this day.</div>
  {/if}
{/snippet}

{#snippet dayPanel(label: string, dateISO: string, plan: ChildDay[])}
  <div class="card p-4">
    <div class="mb-2 flex items-baseline justify-between">
      <span class="card-title">{label}</span>
      <span class="text-xs text-ink-400">{formatDayLabel(dateISO)}</span>
    </div>
    {#if plan.length === 0}
      <p class="text-sm text-ink-500">No children selected.</p>
    {:else}
      <div class="space-y-3">
        {#each plan as child (child.enrollment.id)}
          <div class="rounded-[10px] border border-surface-border p-3">
            <div class="mb-1.5 flex items-center gap-2">
              <Avatar name={childName(child.enrollment)} src={childPhoto(child.enrollment)} size={22} />
              <span class="truncate text-sm font-semibold text-ink-900">{childName(child.enrollment)}</span>
              <span class="ml-auto text-xs text-ink-400">{child.enrollment.class_label ?? ''}</span>
            </div>
            {@render childBody(child)}
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}
