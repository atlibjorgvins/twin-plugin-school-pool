// School Pool — the school-week plugin: who is at which school, what happens
// each weekday, who collects them and when, what has to be in the bag, and
// what is for lunch.
//
// It owns no person of its own: a child IS a core `Person` record, and every
// pickup is attributed to another `Person`. That is the whole reason it is a
// plugin and not an app — it hangs off the contacts core and dies quietly when
// the core is all you keep.
import type { PluginManifest } from '../types';

export const schoolPool: PluginManifest = {
  id: 'school-pool',
  label: 'School Pool',
  description:
    'The school week for the children in your contacts: timetable, pickup times and who collects, holidays and special days, the kit each day needs, and the lunch menu you type in once a week.',
  category: 'Productivity',
  tier: 'public',
  routes: ['/tools/school-pool'],
  collections: ['school_enrollment', 'school_slot', 'school_day', 'school_menu'],
  dependsOn: ['contacts'],
  tiles: [
    {
      label: 'School Pool',
      href: '/tools/school-pool',
      icon: 'school',
      group: 'Day',
      blurb: 'Timetable, pickups, special days, kit and the lunch menu for every child you follow.'
    }
  ],
  settings: [
    {
      key: 'gearTags',
      label: 'Kit shortcuts',
      type: 'text',
      default: 'Swim kit, Gym kit, Outdoor clothes, Library book, Packed lunch',
      placeholder: 'Swim kit, Gym kit, …',
      description:
        'Comma-separated chips offered when tagging what a day needs. Free text — anything you type also sticks.'
    },
    {
      key: 'packAheadAt',
      label: 'Pack for tomorrow from',
      type: 'select',
      default: '16',
      description: 'After this hour the Today panel leads with tomorrow — the bag gets packed the night before.',
      options: [
        { value: '0', label: 'Never — always show today' },
        { value: '14', label: '14:00' },
        { value: '16', label: '16:00' },
        { value: '18', label: '18:00' },
        { value: '20', label: '20:00' }
      ]
    }
  ]
};
