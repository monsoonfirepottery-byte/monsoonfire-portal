import { TAG_GROUPS, type GlazeTag } from "./tags";

export type TagFilters = Record<string, GlazeTag[]>;

export type ComboFilterMeta = {
  hasPhoto: boolean;
  hasNotes: boolean;
  flags: GlazeTag[];
};

export type ComboFilterState = {
  requirePhoto: boolean;
  requireNotes: boolean;
  tagsByGroup: TagFilters;
};

export function createEmptyTagFilters(): TagFilters {
  return TAG_GROUPS.reduce<TagFilters>((acc, group) => {
    acc[group.id] = [];
    return acc;
  }, {});
}

export function getActiveTags(tagsByGroup: TagFilters): GlazeTag[] {
  const active: GlazeTag[] = [];
  Object.values(tagsByGroup).forEach((groupTags) => {
    groupTags.forEach((tag) => {
      if (!active.includes(tag)) {
        active.push(tag);
      }
    });
  });
  return active;
}

export function matchesComboFilters(meta: ComboFilterMeta, state: ComboFilterState): boolean {
  if (state.requirePhoto && !meta.hasPhoto) return false;
  if (state.requireNotes && !meta.hasNotes) return false;

  return TAG_GROUPS.every((group) => {
    const selected = state.tagsByGroup[group.id] || [];
    if (selected.length === 0) return true;
    return selected.some((tag) => meta.flags.includes(tag));
  });
}
