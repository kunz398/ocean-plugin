const THREDDS_BASE_PATH = '/api/thredds';
const THREDDS_ORIGIN = 'https://gemthreddshpc.spc.int';

const COK_SWAN_PATH = '/wms/POP/model/country/spc/forecast/hourly/COK/SWAN_UGRID.nc';
const COK_SFINCS_PATH = '/wms/POP/model/country/spc/forecast/hourly/COK/sfincs_map_epsg4326.nc';

export const getThreddsBase = () => (
  process.env.NODE_ENV === 'development' ? THREDDS_BASE_PATH : `${THREDDS_ORIGIN}/thredds`
);

export const getCookForecastWmsUrl = () => `${getThreddsBase()}${COK_SWAN_PATH}`;

// Direct THREDDS URL (bypasses dev proxy) — used for WMS GetTimeseries
export const getCookForecastWmsDirectUrl = () => `${THREDDS_ORIGIN}/thredds${COK_SWAN_PATH}`;

export const getCookSfincsWmsUrl = () => `${getThreddsBase()}${COK_SFINCS_PATH}`;

export const isProxiedThreddsUrl = (url = '') => url.startsWith(THREDDS_BASE_PATH);

export const isDirectThreddsUrl = (url = '') =>
  url.includes(THREDDS_ORIGIN) || (url.includes('thredds') && !isProxiedThreddsUrl(url));
