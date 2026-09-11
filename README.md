# twin plugin — School Pool

The school week for the children in your contacts. One place for the things a
parent actually has to know by 07:40: what is on today, **who collects them and
when**, what has to be in the bag, and what is for lunch.

It is a [twin](https://github.com/atlibjorgvins/twin) plugin, built to the
plugin contract: one manifest, all data through the neutral `repo` port, no
reach into another plugin, gated everywhere by the id `school-pool`.

## The model, in four rows

A child is **not** a record this plugin owns. A child is a core `Person`, and
the school is a core `organization` when you have a record for it. That is the
whole reason School Pool is a plugin rather than an app — it hangs off the
contacts core, and everything it stores is the part only school makes true.

| Collection | What it is |
| --- | --- |
| `school_enrollment` | One child at one school for one year: the Person, the school, the class, the teacher, who usually collects. |
| `school_slot` | The **weekly** timetable — weekday + time. Lessons, gym, swimming, the after-school club, the pickup. Supports odd/even-week alternation and a mid-year effective window. |
| `school_day` | What a **single date** does differently: holidays, teacher days, short days, trips, someone else collecting. A row with no child named applies to every child. |
| `school_menu` | The canteen menu, typed in by hand. Keyed on the **school**, not the child — siblings at one school read one row, entered once. |

The resolution rule that matters: a dated closure (`cancels_classes`) removes
that day's weekly slots, but never removes the dated rows themselves. "No
school, but the trip leaves at 09:00 from the harbour" is a real Tuesday, and
the timetable must not bury it.

## What ships

| File | Role |
| --- | --- |
| `manifest.ts` | Plugin identity, route, collections, tool tile, and two per-device settings. |
| `data.ts` | Reads and writes through twin's `repo` port — never `@directus/sdk`. |
| `schedule.ts` | The pure part: week/weekday maths, slot applicability, kit deduping, and `planDay` — the resolver that turns slots + dated overrides + menu into one child's day. |
| `schedule.test.ts` | `node --test` over that logic. No network, no Svelte, no timezone. |
| `routes/tools/school-pool/+page.svelte` | Today/Tomorrow panel, week board, and the four editing tabs. |
| `ChildrenEditor.svelte` | Link a child (Person) and a school (organization or plain name). |
| `ScheduleEditor.svelte` | The weekly timetable for one child, by weekday. |
| `SpecialDaysEditor.svelte` | Dated overrides — holidays, trips, one-off pickups. |
| `MenuEditor.svelte` | The week's lunch menu for one school, Mon–Fri. |
| `PersonPicker.svelte` / `GearInput.svelte` | Contact picker; kit chips. |
| `scripts/add-school-pool.sh` | Idempotent Directus schema, every foreign key asserted. |

## Install in twin

1. Declare it in `plugins.json` at the twin repo root:

   ```json
   {
     "external": [
       { "id": "school-pool", "repo": "https://github.com/atlibjorgvins/twin-plugin-school-pool", "ref": "main" }
     ]
   }
   ```

2. Lock and materialise it: `npm run plugins:update` (commit `plugins.json` +
   `plugins.lock` together).

3. Register the manifest in `src/lib/plugins/registry.ts`:

   ```ts
   import { schoolPool } from './school-pool/manifest.ts';
   // …then add `schoolPool` to the PLUGINS array.
   ```

   Add `'school-pool'` to the `FeatureKey` union in `src/lib/plugins/keys.ts`,
   and acknowledge the new id and the `['/tools/school-pool', 'school-pool']`
   route in the snapshot arrays in `src/lib/plugins/registry.test.ts`.

4. Add a tile in `src/lib/tools/catalogue.ts` (twin does not consume manifest
   `tiles` yet), in the **Day** group, gated `feature: 'school-pool'`.

5. Create the collections and grant them:

   ```bash
   bash src/lib/plugins/school-pool/scripts/add-school-pool.sh
   # add school_enrollment school_slot school_day school_menu to PERSONAL, then
   bash scripts/add-member-role.sh
   ```

6. Gitignore the materialised copies in twin (`src/lib/plugins/school-pool/`
   and `src/routes/tools/school-pool/`) — GitHub is their source of truth.

## Settings

Per-device, on Settings → Plugins → School Pool:

- **Kit shortcuts** — the comma-separated chips offered when tagging what a day
  needs. Free text still works; this is only the shortcut row.
- **Pack for tomorrow from** — after this hour the panel leads with tomorrow,
  because that is when the bag gets packed.

## Scope, honestly

Personal data, scoped by `user_created` like twin's other personal collections.
There is no sharing model between two parents' twins yet, no calendar export,
and no import of a school's published timetable — the menu and the special days
are typed in, which is the deliberate trade for a format no school publishes
twice the same way.
