import {
  addProfileRow,
  appendAuditEntry,
  applyProfilePalette,
  cloneProfile,
  createProfileFromCurrent,
  getProfileDiffSummary,
  markProfileAsDraft,
  publishProfile,
  renameProfile,
  removeProfileRow,
  resetProfileToDefaults,
  updateProfileMinVisibleDepth,
  updateProfileResampleColors,
} from '../profiles';

describe('profiles domain', () => {
  test('adds a new row to a profile', () => {
    const profile = resetProfileToDefaults('niue-default');
    const result = addProfileRow(profile);

    expect(result.categories).toHaveLength(profile.categories.length + 1);
    expect(result.categories[result.categories.length - 1].label).toBe('New Band');
  });

  test('applies a palette to all categories', () => {
    const profile = resetProfileToDefaults('niue-default');
    const result = applyProfilePalette(profile, 'viridis');

    expect(result.paletteId).toBe('viridis');
    expect(result.categories[0].color).not.toBe(profile.categories[0].color);
  });

  test('resample colors locks profile to custom', () => {
    const profile = resetProfileToDefaults('niue-default');
    const result = updateProfileResampleColors(profile, true);

    expect(result.resampleColors).toBe(true);
    expect(result.paletteId).toBe('custom');
  });

  test('updates minimum visible depth and removes rows safely', () => {
    const profile = resetProfileToDefaults('niue-default');
    const depthUpdated = updateProfileMinVisibleDepth(profile, '0.125');
    const removed = removeProfileRow(profile, profile.categories[1].id);

    expect(depthUpdated.minVisibleDepth).toBe(0.125);
    expect(removed.categories).toHaveLength(profile.categories.length - 1);
  });

  test('transitions a profile from draft to published with a bumped version', () => {
    const profile = resetProfileToDefaults('niue-default');
    const draft = markProfileAsDraft(profile);
    const published = publishProfile(draft, '2026-06-01T00:00:00.000Z');

    expect(draft.status).toBe('draft');
    expect(published.status).toBe('published');
    expect(published.version).toBe('1.0.1');
    expect(published.publishedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  test('appends audit entries to the front of the log', () => {
    const profile = resetProfileToDefaults('niue-default');
    const updated = appendAuditEntry(profile, {
      type: 'draft_saved',
      summary: 'Draft saved explicitly.',
    });

    expect(updated.auditLog).toHaveLength(1);
    expect(updated.auditLog[0].type).toBe('draft_saved');
    expect(updated.auditLog[0].summary).toBe('Draft saved explicitly.');
  });

  test('computes a draft-vs-published diff summary', () => {
    const profile = resetProfileToDefaults('niue-default');
    const published = publishProfile(profile, '2026-06-01T00:00:00.000Z');
    const draft = {
      ...published,
      status: 'draft',
      paletteId: 'viridis',
      minVisibleDepth: 0.1,
      categories: published.categories.map((category, index) => (
        index === 1 ? { ...category, thresholdM: 0.12 } : category
      )),
    };

    const summary = getProfileDiffSummary(draft);
    expect(summary.hasPublishedSnapshot).toBe(true);
    expect(summary.changed).toBe(true);
    expect(summary.changes.some((change) => change.includes('Palette'))).toBe(true);
    expect(summary.changes.some((change) => change.includes('Minimum visible depth'))).toBe(true);
    expect(summary.changes.some((change) => change.includes('Thresholds changed'))).toBe(true);
    expect(summary.bandChanges.some((change) => change.type === 'modified')).toBe(true);
    expect(summary.bandChanges.some((change) => change.fields.some((field) => field.includes('Threshold')))).toBe(true);
  });

  test('renames, clones, and creates profiles from current state', () => {
    const profile = resetProfileToDefaults('niue-default');
    const renamed = renameProfile(profile, 'Operational Coastal Roads');
    const cloned = cloneProfile(profile, 'Cloned Coastal Roads');
    const created = createProfileFromCurrent(profile, 'Fresh Draft Profile');

    expect(renamed.name).toBe('Operational Coastal Roads');
    expect(cloned.profileId).not.toBe(profile.profileId);
    expect(cloned.name).toBe('Cloned Coastal Roads');
    expect(cloned.status).toBe('draft');
    expect(created.profileId).not.toBe(profile.profileId);
    expect(created.name).toBe('Fresh Draft Profile');
    expect(created.auditLog[0].type).toBe('created');
  });
});
