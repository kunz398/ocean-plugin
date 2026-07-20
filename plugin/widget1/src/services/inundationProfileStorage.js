import {
  DEFAULT_INUNDATION_PROFILE_ID,
  THRESHOLD_SCHEMA_VERSION,
  normalizeThresholdColors,
  validateThresholds,
} from '../config/inundationThresholds';
import {
  DEFAULT_MIN_VISIBLE_DEPTH,
  createSeedProfileMap,
  hydrateProfile,
  serializeProfiles,
  generateProfileRowId,
} from '../domain/inundation/profiles';

export const INUNDATION_PROFILE_STORAGE_KEY = `niu_inundation_thresholds_v${THRESHOLD_SCHEMA_VERSION}`;

export function loadProfilesFromStorage(storage = window.localStorage) {
  const seedMap = createSeedProfileMap();
  const seedProfiles = [...seedMap.values()];

  try {
    const raw = storage.getItem(INUNDATION_PROFILE_STORAGE_KEY);
    if (!raw) {
      return {
        activeProfileId: DEFAULT_INUNDATION_PROFILE_ID,
        profiles: seedProfiles.map((profile) => hydrateProfile(profile, seedMap)),
      };
    }

    const parsed = JSON.parse(raw);

    if (Array.isArray(parsed?.categories)) {
      const defaultProfile = hydrateProfile({
        ...seedMap.get(DEFAULT_INUNDATION_PROFILE_ID),
        categories: parsed.categories,
        paletteId: parsed.paletteId,
        minVisibleDepth: parsed.minVisibleDepth,
        resampleColors: parsed.resampleColors,
        savedAt: parsed.savedAt,
      }, seedMap);

      return {
        activeProfileId: DEFAULT_INUNDATION_PROFILE_ID,
        profiles: seedProfiles.map((profile) => (
          profile.profileId === DEFAULT_INUNDATION_PROFILE_ID ? defaultProfile : hydrateProfile(profile, seedMap)
        )),
      };
    }

    const storedProfiles = Array.isArray(parsed?.profiles) ? parsed.profiles : [];
    const hydratedById = new Map();

    storedProfiles.forEach((profile) => {
      const hydrated = hydrateProfile(profile, seedMap);
      hydratedById.set(hydrated.profileId, hydrated);
    });

    seedProfiles.forEach((seedProfile) => {
      if (!hydratedById.has(seedProfile.profileId)) {
        hydratedById.set(seedProfile.profileId, hydrateProfile(seedProfile, seedMap));
      }
    });

    const profiles = [...hydratedById.values()];
    const activeProfileId = hydratedById.has(parsed?.activeProfileId)
      ? parsed.activeProfileId
      : DEFAULT_INUNDATION_PROFILE_ID;

    return { activeProfileId, profiles };
  } catch {
    return {
      activeProfileId: DEFAULT_INUNDATION_PROFILE_ID,
      profiles: seedProfiles.map((profile) => hydrateProfile(profile, seedMap)),
    };
  }
}

export function saveProfilesToStorage(profiles, activeProfileId, storage = window.localStorage) {
  try {
    storage.setItem(INUNDATION_PROFILE_STORAGE_KEY, JSON.stringify({
      activeProfileId,
      profiles: serializeProfiles(profiles),
    }));
    return true;
  } catch {
    return false;
  }
}

export function buildProfileExportPayload(profile) {
  return {
    schemaVersion: THRESHOLD_SCHEMA_VERSION,
    profileId: profile.profileId,
    name: profile.name,
    description: profile.description,
    scopeLabel: profile.scopeLabel,
    status: profile.status,
    version: profile.version,
    publishedAt: profile.publishedAt,
    auditLog: profile.auditLog || [],
    exportedAt: new Date().toISOString(),
    paletteId: profile.paletteId,
    minVisibleDepth: profile.minVisibleDepth,
    resampleColors: profile.resampleColors,
    categories: profile.categories,
  };
}

export function parseImportedProfileDocument(parsed) {
  const imported = Array.isArray(parsed) ? parsed : parsed?.categories;
  if (!Array.isArray(imported)) {
    return { ok: false, errors: ['File does not contain a categories array.'] };
  }

  const withIds = imported.map((category) => ({
    ...category,
    id: category.id || generateProfileRowId(),
    thresholdM: Number(category.thresholdM),
  }));
  const normalized = normalizeThresholdColors(withIds);
  const errors = validateThresholds(normalized);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    payload: {
      paletteId: typeof parsed?.paletteId === 'string' ? parsed.paletteId : 'custom',
      minVisibleDepth: Number.isFinite(Number(parsed?.minVisibleDepth))
        ? Math.max(0, Number(Number(parsed.minVisibleDepth).toFixed(3)))
        : DEFAULT_MIN_VISIBLE_DEPTH,
      resampleColors: parsed?.resampleColors === true,
      categories: normalized,
    },
  };
}
