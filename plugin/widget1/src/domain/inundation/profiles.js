import {
  DEFAULT_INUNDATION_PROFILE_ID,
  DEFAULT_INUNDATION_THRESHOLDS,
  getXSstColorAtDepth,
  getPaletteColorAtDepth,
  applyPaletteToThresholds,
  INUNDATION_PALETTE_OPTIONS,
  normalizeThresholdColors,
  validateThresholds,
  deepCloneThresholds,
  deepCloneDefaultProfiles,
} from '../../config/inundationThresholds';

export const DEFAULT_MIN_VISIBLE_DEPTH = 0;
export const DEFAULT_RESAMPLE_COLORS = false;
const MAX_AUDIT_ENTRIES = 12;

function normalizeProfileStatus(status, fallback = 'published') {
  if (status === 'approved') return 'published';
  if (status === 'published' || status === 'draft') return status;
  return fallback;
}

function bumpPatchVersion(version) {
  const parts = String(version || '1.0.0').split('.');
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(Number(part)))) {
    return '1.0.0';
  }
  return `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
}

export function generateProfileRowId() {
  return `niu-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function generateAuditEntryId() {
  return `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function generateProfileId(name = 'profile') {
  const slug = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'profile';
  return `${slug}-${Date.now().toString(36)}`;
}

function createPublishedSnapshot(profile) {
  return {
    version: profile.version,
    paletteId: profile.paletteId,
    minVisibleDepth: profile.minVisibleDepth,
    resampleColors: profile.resampleColors,
    categories: deepCloneThresholds(profile.categories),
    publishedAt: profile.publishedAt || null,
  };
}

function lerpHex(hex1, hex2, t) {
  const parse = (h) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(hex1);
  const [r2, g2, b2] = parse(hex2);
  return `#${[
    Math.round(r1 + (r2 - r1) * t),
    Math.round(g1 + (g2 - g1) * t),
    Math.round(b1 + (b2 - b1) * t),
  ].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export function respreadColors(categories, stops) {
  if (categories.length < 2 || stops.length < 2) return categories;
  const n = categories.length;
  const maxStop = stops.length - 1;
  return categories.map((category, i) => {
    const pos = (i / (n - 1)) * maxStop;
    const lo = Math.floor(pos);
    const hi = Math.min(Math.ceil(pos), maxStop);
    const color = lo === hi ? stops[lo] : lerpHex(stops[lo], stops[hi], pos - lo);
    return { ...category, color };
  });
}

export function createSeedProfileMap() {
  return new Map(deepCloneDefaultProfiles().map((profile) => [profile.profileId, profile]));
}

export function hydrateProfile(profile, seedMap) {
  const seed = seedMap.get(profile?.profileId) || seedMap.get(DEFAULT_INUNDATION_PROFILE_ID);
  const importedCategories = Array.isArray(profile?.categories)
    ? normalizeThresholdColors(profile.categories.map((category) => ({
      ...category,
      thresholdM: Number(category?.thresholdM),
    })))
    : null;
  const categories = importedCategories && validateThresholds(importedCategories).length === 0
    ? importedCategories
    : deepCloneThresholds(seed.categories);
  const hasPalette = INUNDATION_PALETTE_OPTIONS.some((option) => option.id === profile?.paletteId);
  const minVisibleDepth = Number(profile?.minVisibleDepth);

  return {
    profileId: typeof profile?.profileId === 'string' ? profile.profileId : seed.profileId,
    name: typeof profile?.name === 'string' && profile.name.trim() ? profile.name : seed.name,
    description: typeof profile?.description === 'string' && profile.description.trim()
      ? profile.description
      : seed.description,
    scopeLabel: typeof profile?.scopeLabel === 'string' && profile.scopeLabel.trim()
      ? profile.scopeLabel
      : seed.scopeLabel,
    status: normalizeProfileStatus(
      typeof profile?.status === 'string' && profile.status.trim() ? profile.status : seed.status,
      normalizeProfileStatus(seed.status)
    ),
    version: typeof profile?.version === 'string' && profile.version.trim() ? profile.version : seed.version,
    paletteId: hasPalette ? profile.paletteId : (seed.paletteId || 'x-sst'),
    minVisibleDepth: Number.isFinite(minVisibleDepth)
      ? Math.max(0, Number(minVisibleDepth.toFixed(3)))
      : (seed.minVisibleDepth ?? DEFAULT_MIN_VISIBLE_DEPTH),
    resampleColors: profile?.resampleColors === true,
    categories,
    lastValidCategories: deepCloneThresholds(categories),
    savedAt: typeof profile?.savedAt === 'string' ? profile.savedAt : null,
    publishedAt: typeof profile?.publishedAt === 'string' ? profile.publishedAt : (seed.publishedAt || null),
    publishedSnapshot: profile?.publishedSnapshot || createPublishedSnapshot({
      version: typeof profile?.version === 'string' && profile.version.trim() ? profile.version : seed.version,
      paletteId: hasPalette ? profile.paletteId : (seed.paletteId || 'x-sst'),
      minVisibleDepth: Number.isFinite(minVisibleDepth)
        ? Math.max(0, Number(minVisibleDepth.toFixed(3)))
        : (seed.minVisibleDepth ?? DEFAULT_MIN_VISIBLE_DEPTH),
      resampleColors: profile?.resampleColors === true,
      categories,
      publishedAt: typeof profile?.publishedAt === 'string' ? profile.publishedAt : (seed.publishedAt || null),
    }),
    auditLog: Array.isArray(profile?.auditLog) ? profile.auditLog.slice(0, MAX_AUDIT_ENTRIES) : [],
    isDirty: false,
  };
}

export function serializeProfiles(profiles) {
  return profiles.map((profile) => ({
    profileId: profile.profileId,
    name: profile.name,
    description: profile.description,
    scopeLabel: profile.scopeLabel,
    status: profile.status,
    version: profile.version,
    paletteId: profile.paletteId,
    minVisibleDepth: profile.minVisibleDepth,
    resampleColors: profile.resampleColors,
    categories: profile.categories,
    savedAt: profile.savedAt,
    publishedAt: profile.publishedAt,
    publishedSnapshot: profile.publishedSnapshot || null,
    auditLog: profile.auditLog || [],
  }));
}

export function getProfileById(profiles, profileId) {
  return profiles.find((profile) => profile.profileId === profileId) || profiles[0] || null;
}

export function replaceActiveProfile(profiles, activeProfileId, update) {
  return profiles.map((profile) => (
    profile.profileId === activeProfileId ? update(profile) : profile
  ));
}

export function updateProfileRow(profile, id, field, rawValue) {
  const value = field === 'thresholdM' ? Number(rawValue) : rawValue;
  return {
    ...profile,
    categories: profile.categories.map((category) =>
      category.id === id
        ? {
          ...category,
          [field]: value,
          ...(field === 'thresholdM' && profile.paletteId !== 'custom'
            ? { color: getPaletteColorAtDepth(value, profile.paletteId) }
            : {}),
        }
        : category
    ),
    paletteId: field === 'color' ? 'custom' : profile.paletteId,
  };
}

export function addProfileRow(profile) {
  const last = profile.categories[profile.categories.length - 1];
  const nextThreshold = parseFloat(((last?.thresholdM ?? 0) + 0.3).toFixed(2));
  let categories = [
    ...profile.categories,
    {
      id: generateProfileRowId(),
      thresholdM: nextThreshold,
      label: 'New Band',
      description: 'Describe the operational impact at this depth',
      color: profile.paletteId === 'custom'
        ? getXSstColorAtDepth(nextThreshold)
        : getPaletteColorAtDepth(nextThreshold, profile.paletteId),
    },
  ];

  if (profile.resampleColors) {
    const stops = profile.categories.map((category) => category.color);
    categories = respreadColors(categories, stops);
  }

  return {
    ...profile,
    categories,
    paletteId: profile.resampleColors ? 'custom' : profile.paletteId,
  };
}

export function removeProfileRow(profile, id) {
  if (profile.categories.length <= 2) return profile;
  let categories = profile.categories.filter((category) => category.id !== id);
  if (profile.resampleColors) {
    const stops = profile.categories.map((category) => category.color);
    categories = respreadColors(categories, stops);
  }
  return {
    ...profile,
    categories,
    paletteId: profile.resampleColors ? 'custom' : profile.paletteId,
  };
}

export function moveProfileRow(profile, id, direction) {
  const idx = profile.categories.findIndex((category) => category.id === id);
  if (idx < 0) return profile;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= profile.categories.length) return profile;
  const categories = [...profile.categories];
  [categories[idx], categories[newIdx]] = [categories[newIdx], categories[idx]];
  return { ...profile, categories };
}

export function applyProfilePalette(profile, nextPaletteId) {
  if (nextPaletteId === 'custom') {
    return { ...profile, paletteId: 'custom', isDirty: true };
  }
  return {
    ...profile,
    paletteId: nextPaletteId,
    categories: applyPaletteToThresholds(profile.categories, nextPaletteId),
  };
}

export function updateProfileMinVisibleDepth(profile, rawValue) {
  const parsed = Number(rawValue);
  const minVisibleDepth = Number.isFinite(parsed)
    ? Math.max(0, Number(parsed.toFixed(3)))
    : profile.minVisibleDepth;
  return { ...profile, minVisibleDepth };
}

export function updateProfileResampleColors(profile, enabled) {
  if (enabled && profile.categories.length >= 2) {
    const stops = profile.categories.map((category) => category.color);
    return {
      ...profile,
      categories: respreadColors(profile.categories, stops),
      paletteId: 'custom',
      resampleColors: true,
    };
  }
  return { ...profile, resampleColors: enabled };
}

export function resetProfileToDefaults(profileId) {
  const seedMap = createSeedProfileMap();
  const seedProfile = seedMap.get(profileId) || {
    ...seedMap.get(DEFAULT_INUNDATION_PROFILE_ID),
    categories: DEFAULT_INUNDATION_THRESHOLDS,
  };

  return {
    ...seedProfile,
    categories: deepCloneThresholds(seedProfile.categories),
    lastValidCategories: deepCloneThresholds(seedProfile.categories),
    savedAt: null,
    publishedAt: seedProfile.publishedAt || null,
    publishedSnapshot: seedProfile.publishedSnapshot || createPublishedSnapshot(seedProfile),
    auditLog: seedProfile.auditLog || [],
    isDirty: false,
  };
}

export function markProfileAsDraft(profile) {
  return {
    ...profile,
    status: 'draft',
  };
}

export function publishProfile(profile, publishedAt = new Date().toISOString()) {
  const nextProfile = {
    ...profile,
    status: 'published',
    version: bumpPatchVersion(profile.version),
    publishedAt,
    savedAt: publishedAt,
    lastValidCategories: deepCloneThresholds(profile.categories),
    isDirty: false,
  };
  return {
    ...nextProfile,
    publishedSnapshot: createPublishedSnapshot(nextProfile),
  };
}

export function appendAuditEntry(profile, entry) {
  const auditEntry = {
    id: generateAuditEntryId(),
    at: new Date().toISOString(),
    type: entry?.type || 'updated',
    summary: entry?.summary || 'Profile updated',
  };
  return {
    ...profile,
    auditLog: [auditEntry, ...(profile.auditLog || [])].slice(0, MAX_AUDIT_ENTRIES),
  };
}

export function renameProfile(profile, nextName) {
  const trimmed = String(nextName || '').trim();
  if (!trimmed) {
    return profile;
  }
  return {
    ...profile,
    name: trimmed,
  };
}

export function cloneProfile(profile, nextName) {
  const cloned = {
    ...profile,
    profileId: generateProfileId(nextName || `${profile.name} copy`),
    name: String(nextName || `${profile.name} Copy`).trim(),
    status: 'draft',
    version: '1.0.0',
    savedAt: null,
    publishedAt: null,
    categories: deepCloneThresholds(profile.categories),
    lastValidCategories: deepCloneThresholds(profile.categories),
    publishedSnapshot: profile.publishedSnapshot ? {
      ...profile.publishedSnapshot,
      categories: deepCloneThresholds(profile.publishedSnapshot.categories),
    } : createPublishedSnapshot(profile),
    auditLog: [],
    isDirty: false,
  };
  return appendAuditEntry(cloned, {
    type: 'created',
    summary: `Cloned from ${profile.name}.`,
  });
}

export function createProfileFromCurrent(profile, nextName) {
  const created = {
    ...profile,
    profileId: generateProfileId(nextName || profile.name),
    name: String(nextName || `${profile.name} Draft`).trim(),
    status: 'draft',
    version: '1.0.0',
    savedAt: null,
    publishedAt: null,
    categories: deepCloneThresholds(profile.categories),
    lastValidCategories: deepCloneThresholds(profile.categories),
    publishedSnapshot: createPublishedSnapshot(profile),
    auditLog: [],
    isDirty: false,
  };
  return appendAuditEntry(created, {
    type: 'created',
    summary: 'Created new profile from current draft.',
  });
}

export function getProfileDiffSummary(profile) {
  const snapshot = profile?.publishedSnapshot;
  if (!snapshot) {
    return {
      hasPublishedSnapshot: false,
      changed: false,
      changes: [],
    };
  }

  const changes = [];
  const bandChanges = [];
  if (profile.paletteId !== snapshot.paletteId) changes.push(`Palette: ${snapshot.paletteId} -> ${profile.paletteId}`);
  if (profile.minVisibleDepth !== snapshot.minVisibleDepth) {
    changes.push(`Minimum visible depth: ${snapshot.minVisibleDepth}m -> ${profile.minVisibleDepth}m`);
  }
  if (profile.resampleColors !== snapshot.resampleColors) {
    changes.push(`Palette redistribution: ${snapshot.resampleColors ? 'on' : 'off'} -> ${profile.resampleColors ? 'on' : 'off'}`);
  }
  if ((profile.categories || []).length !== (snapshot.categories || []).length) {
    changes.push(`Band count: ${(snapshot.categories || []).length} -> ${(profile.categories || []).length}`);
  }

  const changedThresholds = [];
  const changedLabels = [];
  const changedDescriptions = [];
  const changedColors = [];
  const currentById = new Map((profile.categories || []).map((category) => [category.id, category]));

  (snapshot.categories || []).forEach((category) => {
    const current = currentById.get(category.id);
    if (!current) {
      changes.push(`Removed band: ${category.label}`);
      bandChanges.push({
        id: category.id,
        type: 'removed',
        label: category.label,
        fields: ['Band removed from draft profile.'],
      });
      return;
    }
    const fields = [];
    if (current.thresholdM !== category.thresholdM) fields.push(`Threshold: ${category.thresholdM}m -> ${current.thresholdM}m`);
    if (current.label !== category.label) fields.push(`Label: ${category.label} -> ${current.label}`);
    if (current.description !== category.description) fields.push('Description changed');
    if (String(current.color).toLowerCase() !== String(category.color).toLowerCase()) {
      fields.push(`Color: ${category.color} -> ${current.color}`);
    }
    if (current.thresholdM !== category.thresholdM) changedThresholds.push(category.label);
    if (current.label !== category.label) changedLabels.push(category.id);
    if (current.description !== category.description) changedDescriptions.push(current.label);
    if (String(current.color).toLowerCase() !== String(category.color).toLowerCase()) changedColors.push(current.label);
    if (fields.length > 0) {
      bandChanges.push({
        id: category.id,
        type: 'modified',
        label: current.label,
        fields,
      });
    }
  });

  (profile.categories || []).forEach((category) => {
    const existed = (snapshot.categories || []).some((previous) => previous.id === category.id);
    if (!existed) {
      changes.push(`Added band: ${category.label}`);
      bandChanges.push({
        id: category.id,
        type: 'added',
        label: category.label,
        fields: [`Threshold: ${category.thresholdM}m`, `Color: ${category.color}`],
      });
    }
  });

  if (changedThresholds.length) changes.push(`Thresholds changed: ${changedThresholds.join(', ')}`);
  if (changedLabels.length) changes.push(`Labels changed: ${changedLabels.length}`);
  if (changedDescriptions.length) changes.push(`Descriptions changed: ${changedDescriptions.length}`);
  if (changedColors.length) changes.push(`Colors changed: ${changedColors.join(', ')}`);

  return {
    hasPublishedSnapshot: true,
    changed: changes.length > 0,
    publishedVersion: snapshot.version,
    publishedAt: snapshot.publishedAt || null,
    changes,
    bandChanges,
  };
}
