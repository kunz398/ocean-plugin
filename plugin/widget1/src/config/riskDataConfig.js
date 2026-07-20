// const publicBaseUrl = process.env.PUBLIC_URL || '';
const defaultRiskBaseUrl =
  'https://gemthreddshpc.spc.int/thredds/fileServer/POP/model/country/spc/forecast/hourly/NIU/risk';

export const RISK_DATA_CONFIG = {
  version: '1.0',
  basePath: process.env.REACT_APP_RISK_DATA_BASE_URL || defaultRiskBaseUrl,
  pointsFile: 'points.json',
  detailsDirectory: 'details',
  representativeZoomThreshold: 10
};

export const getRiskPointsUrl = () => (
  `${RISK_DATA_CONFIG.basePath}/${RISK_DATA_CONFIG.pointsFile}`
);

export const getRiskDetailsUrl = (pointId) => (
  `${RISK_DATA_CONFIG.basePath}/${RISK_DATA_CONFIG.detailsDirectory}/${pointId}.json`
);
