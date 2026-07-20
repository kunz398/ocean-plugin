import { useState, useCallback, useRef, useMemo } from 'react';
import {
  validateThresholds,
  deepCloneThresholds,
} from '../config/inundationThresholds';
import {
  DEFAULT_MIN_VISIBLE_DEPTH,
  DEFAULT_RESAMPLE_COLORS,
  getProfileById,
  replaceActiveProfile,
  updateProfileRow,
  addProfileRow,
  removeProfileRow,
  moveProfileRow,
  applyProfilePalette,
  updateProfileMinVisibleDepth,
  updateProfileResampleColors,
  resetProfileToDefaults,
  markProfileAsDraft,
  publishProfile as publishProfileState,
  appendAuditEntry,
  getProfileDiffSummary,
  renameProfile as renameProfileState,
  cloneProfile as cloneProfileState,
  createProfileFromCurrent,
} from '../domain/inundation/profiles';
import {
  loadProfilesFromStorage,
  saveProfilesToStorage,
  buildProfileExportPayload,
  parseImportedProfileDocument,
} from '../services/inundationProfileStorage';
const MAX_HISTORY = 20;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const INITIAL_STORED = loadProfilesFromStorage();

/**
 * Profile-aware hazard threshold editor state.
 * Each profile owns its own categories, palette choice, visible-depth filter,
 * and persistence metadata, while the hook exposes the currently active profile
 * through the same narrow interface expected by the rendering layer.
 */
export default function useInundationThresholds() {
  const [profiles, setProfiles] = useState(INITIAL_STORED.profiles);
  const [activeProfileId, setActiveProfileId] = useState(INITIAL_STORED.activeProfileId);
  const [saveError, setSaveError] = useState(null);
  const [undoSize, setUndoSize] = useState(0);
  const [redoSize, setRedoSize] = useState(0);

  const undoStack = useRef([]);
  const redoStack = useRef([]);

  const activeProfile = useMemo(
    () => getProfileById(profiles, activeProfileId),
    [profiles, activeProfileId]
  );
  const diffSummary = useMemo(
    () => getProfileDiffSummary(activeProfile),
    [activeProfile]
  );

  const pushUndo = useCallback((snapshot) => {
    undoStack.current = [
      ...undoStack.current.slice(-MAX_HISTORY + 1),
      deepClone(snapshot),
    ];
    redoStack.current = [];
    setUndoSize(undoStack.current.length);
    setRedoSize(0);
  }, []);

  const persistProfiles = useCallback((nextProfiles, nextActiveProfileId) => {
    const persisted = saveProfilesToStorage(nextProfiles, nextActiveProfileId);
    if (!persisted) {
      setSaveError('Browser storage is unavailable — changes will not persist after reload.');
      return false;
    }
    setSaveError(null);
    return true;
  }, []);

  const commitNext = useCallback((prevSnapshot, nextSnapshot) => {
    pushUndo(prevSnapshot);

    const currentActive = getProfileById(nextSnapshot.profiles, nextSnapshot.activeProfileId);
    const errors = validateThresholds(currentActive.categories);
    let nextProfiles = nextSnapshot.profiles;

    if (errors.length === 0) {
      const savedAt = new Date().toISOString();
      nextProfiles = replaceActiveProfile(nextProfiles, nextSnapshot.activeProfileId, (profile) => ({
        ...appendAuditEntry(markProfileAsDraft(profile), {
          type: 'draft_saved',
          summary: 'Draft saved from editor changes.',
        }),
        savedAt,
        lastValidCategories: deepCloneThresholds(profile.categories),
        isDirty: false,
      }));
      const persisted = persistProfiles(nextProfiles, nextSnapshot.activeProfileId);
      if (!persisted) {
        nextProfiles = replaceActiveProfile(nextProfiles, nextSnapshot.activeProfileId, (profile) => ({
          ...profile,
          isDirty: true,
        }));
      }
    } else {
      nextProfiles = replaceActiveProfile(nextProfiles, nextSnapshot.activeProfileId, (profile) => ({
        ...profile,
        isDirty: true,
      }));
    }

    setProfiles(nextProfiles);
    setActiveProfileId(nextSnapshot.activeProfileId);
  }, [persistProfiles, pushUndo]);

  const switchProfile = useCallback((nextProfileId) => {
    if (nextProfileId === activeProfileId) return;
    const nextProfile = getProfileById(profiles, nextProfileId);
    if (!nextProfile) return;

    setActiveProfileId(nextProfile.profileId);
    undoStack.current = [];
    redoStack.current = [];
    setUndoSize(0);
    setRedoSize(0);

    const persisted = persistProfiles(profiles, nextProfile.profileId);
    if (!persisted) {
      setProfiles(replaceActiveProfile(profiles, nextProfile.profileId, (profile) => ({
        ...profile,
        isDirty: true,
      })));
    }
  }, [activeProfileId, persistProfiles, profiles]);

  const renameProfile = useCallback((nextName) => {
    const trimmed = String(nextName || '').trim();
    if (!trimmed) {
      return { ok: false, error: 'Profile name cannot be empty.' };
    }
    const nextProfiles = replaceActiveProfile(profiles, activeProfileId, (profile) => (
      appendAuditEntry(renameProfileState(profile, trimmed), {
        type: 'renamed',
        summary: `Renamed profile to ${trimmed}.`,
      })
    ));
    const persisted = persistProfiles(nextProfiles, activeProfileId);
    if (!persisted) {
      return { ok: false, error: 'Storage write failed. Rename will be lost on reload.' };
    }
    setProfiles(nextProfiles);
    return { ok: true };
  }, [activeProfileId, persistProfiles, profiles]);

  const cloneProfile = useCallback((nextName) => {
    const cloned = cloneProfileState(activeProfile, nextName);
    const nextProfiles = [...profiles, cloned];
    const persisted = persistProfiles(nextProfiles, cloned.profileId);
    if (!persisted) {
      return { ok: false, error: 'Storage write failed. Clone will be lost on reload.' };
    }
    setProfiles(nextProfiles);
    setActiveProfileId(cloned.profileId);
    undoStack.current = [];
    redoStack.current = [];
    setUndoSize(0);
    setRedoSize(0);
    return { ok: true };
  }, [activeProfile, persistProfiles, profiles]);

  const createProfile = useCallback((nextName) => {
    const created = createProfileFromCurrent(activeProfile, nextName);
    const nextProfiles = [...profiles, created];
    const persisted = persistProfiles(nextProfiles, created.profileId);
    if (!persisted) {
      return { ok: false, error: 'Storage write failed. New profile will be lost on reload.' };
    }
    setProfiles(nextProfiles);
    setActiveProfileId(created.profileId);
    undoStack.current = [];
    redoStack.current = [];
    setUndoSize(0);
    setRedoSize(0);
    return { ok: true };
  }, [activeProfile, persistProfiles, profiles]);

  const updateActiveProfile = useCallback((updater) => {
    const nextProfiles = replaceActiveProfile(profiles, activeProfileId, updater);
    commitNext(
      { profiles, activeProfileId },
      { profiles: nextProfiles, activeProfileId }
    );
  }, [activeProfileId, commitNext, profiles]);

  const updateRow = useCallback((id, field, rawValue) => {
    updateActiveProfile((profile) => updateProfileRow(profile, id, field, rawValue));
  }, [updateActiveProfile]);

  const addRow = useCallback(() => {
    updateActiveProfile((profile) => addProfileRow(profile));
  }, [updateActiveProfile]);

  const removeRow = useCallback((id) => {
    updateActiveProfile((profile) => removeProfileRow(profile, id));
  }, [updateActiveProfile]);

  const moveRow = useCallback((id, direction) => {
    updateActiveProfile((profile) => moveProfileRow(profile, id, direction));
  }, [updateActiveProfile]);

  const applyPalette = useCallback((nextPaletteId) => {
    updateActiveProfile((profile) => applyProfilePalette(profile, nextPaletteId));
  }, [updateActiveProfile]);

  const updateMinVisibleDepth = useCallback((rawValue) => {
    updateActiveProfile((profile) => updateProfileMinVisibleDepth(profile, rawValue));
  }, [updateActiveProfile]);

  const updateResampleColors = useCallback((enabled) => {
    updateActiveProfile((profile) => updateProfileResampleColors(profile, enabled));
  }, [updateActiveProfile]);

  const applySnapshot = useCallback((snapshot) => {
    setProfiles(snapshot.profiles);
    setActiveProfileId(snapshot.activeProfileId);
  }, []);

  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    const snapshot = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, deepClone({ profiles, activeProfileId })];
    setUndoSize(undoStack.current.length);
    setRedoSize(redoStack.current.length);
    applySnapshot(snapshot);
    persistProfiles(snapshot.profiles, snapshot.activeProfileId);
  }, [activeProfileId, applySnapshot, persistProfiles, profiles]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const snapshot = redoStack.current[redoStack.current.length - 1];
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, deepClone({ profiles, activeProfileId })];
    setUndoSize(undoStack.current.length);
    setRedoSize(redoStack.current.length);
    applySnapshot(snapshot);
    persistProfiles(snapshot.profiles, snapshot.activeProfileId);
  }, [activeProfileId, applySnapshot, persistProfiles, profiles]);

  const save = useCallback(() => {
    if (validateThresholds(activeProfile.categories).length > 0) {
      return { ok: false, error: 'Fix validation errors before saving.' };
    }
    const savedAt = new Date().toISOString();
    const nextProfiles = replaceActiveProfile(profiles, activeProfileId, (profile) => ({
      ...appendAuditEntry(markProfileAsDraft(profile), {
        type: 'draft_saved',
        summary: 'Draft saved explicitly.',
      }),
      savedAt,
      lastValidCategories: deepCloneThresholds(profile.categories),
      isDirty: false,
    }));
    const persisted = persistProfiles(nextProfiles, activeProfileId);
    if (!persisted) {
      return { ok: false, error: 'Storage write failed. Settings will be lost on reload.' };
    }
    setProfiles(nextProfiles);
    return { ok: true };
  }, [activeProfile, activeProfileId, persistProfiles, profiles]);

  const publishProfile = useCallback(() => {
    if (validateThresholds(activeProfile.categories).length > 0) {
      return { ok: false, error: 'Fix validation errors before publishing.' };
    }
    const publishedAt = new Date().toISOString();
    const nextProfiles = replaceActiveProfile(profiles, activeProfileId, (profile) => {
      const publishedProfile = publishProfileState(profile, publishedAt);
      return appendAuditEntry(publishedProfile, {
        type: 'published',
        summary: `Published profile version ${publishedProfile.version}.`,
      });
    });
    const persisted = persistProfiles(nextProfiles, activeProfileId);
    if (!persisted) {
      return { ok: false, error: 'Storage write failed. Publish state will be lost on reload.' };
    }
    setProfiles(nextProfiles);
    return { ok: true };
  }, [activeProfile, activeProfileId, persistProfiles, profiles]);

  const resetToDefaults = useCallback(() => {
    updateActiveProfile(() => appendAuditEntry(resetProfileToDefaults(activeProfileId), {
      type: 'reset',
      summary: 'Reverted profile to seeded defaults.',
    }));
  }, [activeProfileId, updateActiveProfile]);

  const exportJson = useCallback(() => {
    const payload = JSON.stringify(buildProfileExportPayload(activeProfile), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeProfile.profileId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeProfile]);

  const importJson = useCallback(
    (file) =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const parsed = JSON.parse(e.target.result);
            const result = parseImportedProfileDocument(parsed);
            if (!result.ok) {
              resolve(result);
              return;
            }

            updateActiveProfile((profile) => ({
              ...appendAuditEntry({
                ...profile,
                ...result.payload,
              }, {
                type: 'imported',
                summary: 'Imported thresholds from JSON.',
              }),
            }));
            resolve({ ok: true });
          } catch {
            resolve({ ok: false, errors: ['Could not parse the JSON file.'] });
          }
        };
        reader.readAsText(file);
      }),
    [updateActiveProfile]
  );

  const validationErrors = validateThresholds(activeProfile?.categories || []);

  return {
    profiles,
    activeProfileId,
    activeProfile,
    diffSummary,
    categories: activeProfile?.categories || [],
    lastValidCategories: activeProfile?.lastValidCategories || activeProfile?.categories || [],
    auditLog: activeProfile?.auditLog || [],
    paletteId: activeProfile?.paletteId || 'x-sst',
    minVisibleDepth: activeProfile?.minVisibleDepth ?? DEFAULT_MIN_VISIBLE_DEPTH,
    resampleColors: activeProfile?.resampleColors ?? DEFAULT_RESAMPLE_COLORS,
    validationErrors,
    isDirty: activeProfile?.isDirty ?? false,
    savedAt: activeProfile?.savedAt ?? null,
    saveError,
    canUndo: undoSize > 0,
    canRedo: redoSize > 0,
    switchProfile,
    renameProfile,
    cloneProfile,
    createProfile,
    updateRow,
    addRow,
    removeRow,
    moveRow,
    updateMinVisibleDepth,
    updateResampleColors,
    undo,
    redo,
    applyPalette,
    save,
    publishProfile,
    resetToDefaults,
    exportJson,
    importJson,
  };
}
