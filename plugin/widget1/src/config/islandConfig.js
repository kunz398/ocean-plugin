export const ISLAND_ZOOM_TARGETS = [
  {
    id: 'niue',
    label: 'Niue',
    group: 'Niue',
    bounds: {
      southWest: [-19.5, -170.5],
      northEast: [-18.5, -169.3],
    },
  },
];

export const findIslandZoomTarget = (targetId) => (
  ISLAND_ZOOM_TARGETS.find((target) => target.id === targetId) || null
);
