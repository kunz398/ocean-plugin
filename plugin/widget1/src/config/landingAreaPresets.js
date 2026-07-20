// landingAreaPresets.js
// PLACEHOLDER DATA — coordinates are illustrative/unverified example canoe and
// small-boat launch areas. Replace with stakeholder-confirmed landing-site
// coordinates before operational use.
//
// The "⚠ Unverified placeholder" wording (not just a parenthetical) is
// deliberate: LandingAreaPanel renders `label` directly as a <select>
// option, and a dropdown is easy to skim past — a leading warning glyph is
// far harder to miss than a trailing "(unverified)" a user has stopped
// reading by. LandingAreaPanel also surfaces a standalone warning line once
// a preset is selected, so the caveat isn't only visible while the dropdown
// is open.
//
// `name` is the bare place name with no warning decoration — used by
// LandingAreaDetailsPanel's header, which shows the unverified caveat as its
// own banner instead of folding it into the title (a location name and a
// data-quality warning competing for the same line was the earlier design;
// see LandingAreaDetailsPanel.jsx). `label` (with the glyph) stays as-is for
// the dropdown, unchanged by this.
export const LANDING_AREA_PRESETS = [
  {
    id: 'alofi',
    name: 'Alofi Wharf',
    label: '⚠ Alofi Wharf — unverified placeholder',
    lon: -169.9166,
    lat: -19.0545,
    radiusKm: 0.5,
    verificationStatus: 'unverified',
    sourceNote: 'Placeholder canoe/small-boat launch point.',
  },
  {
    id: 'avatele',
    name: 'Avatele Landing',
    label: '⚠ Avatele Landing — unverified placeholder',
    lon: -169.9367,
    lat: -19.1211,
    radiusKm: 0.5,
    verificationStatus: 'unverified',
    sourceNote: 'Placeholder canoe/small-boat launch point.',
  },
  {
    id: 'namukulu',
    name: 'Namukulu',
    label: '⚠ Namukulu — unverified placeholder',
    lon: -169.8600,
    lat: -18.9580,
    radiusKm: 0.5,
    verificationStatus: 'unverified',
    sourceNote: 'Placeholder canoe/small-boat launch point.',
  },
  {
    id: 'liku',
    name: 'Liku',
    label: '⚠ Liku — unverified placeholder',
    lon: -169.7847,
    lat: -19.0761,
    radiusKm: 0.5,
    verificationStatus: 'unverified',
    sourceNote: 'Placeholder canoe/small-boat launch point.',
  },
];
