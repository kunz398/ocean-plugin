/**
 * Base inundation provider contract.
 *
 * Every concrete provider must implement these methods with the shapes below.
 * Import InundationProvider and extend it, or duck-type match the interface.
 *
 * rangeWindow shapes:
 *   { mode: 'single' }
 *   { mode: 'rolling-48h', startIndex: number, endIndex: number }
 *   { mode: 'custom', startIndex: number, endIndex: number, startTime: Date, endTime: Date }
 *
 * capabilities:
 *   { timestepRaster: bool, rangeMaxRaster: bool, pointValue: bool, timeseries: bool }
 */
export default class InundationProvider {
  /** @type {string} */
  id = 'base';

  /** @type {string} */
  label = 'Base';

  /** @type {{ timestepRaster: boolean, rangeMaxRaster: boolean, pointValue: boolean, timeseries: boolean }} */
  capabilities = {
    timestepRaster: false,
    rangeMaxRaster: false,
    pointValue: false,
    timeseries: false,
  };

  /** @returns {Promise<Object>} */
  // eslint-disable-next-line class-methods-use-this
  async loadMetadata() { throw new Error('Not implemented'); }

  /** @returns {Promise<Date[]>} */
  // eslint-disable-next-line class-methods-use-this
  async loadTimesteps() { throw new Error('Not implemented'); }

  /**
   * Returns a URL string (sync for FastAPI, or async Promise<string> for Zarr).
   * Callers within providers must handle both forms via await Promise.resolve().
   * Hooks should not call this directly — use preloadFrame/warmupFrames instead.
   */
  // eslint-disable-next-line class-methods-use-this
  getFrameUrl() { throw new Error('Not implemented'); }

  /** @returns {Promise<{ url: string, image: HTMLImageElement }>} */
  // eslint-disable-next-line class-methods-use-this
  async preloadFrame() { throw new Error('Not implemented'); }

  /** @returns {Promise<HTMLImageElement[]>} */
  // eslint-disable-next-line class-methods-use-this
  async warmupFrames() { throw new Error('Not implemented'); }

  /** @returns {Promise<Object>} */
  // eslint-disable-next-line class-methods-use-this
  async getTimeseries() { throw new Error('Not implemented'); }

  /** @returns {Promise<{ value: string, available: boolean, reason?: string }>} */
  // eslint-disable-next-line class-methods-use-this
  async getPointValue() { throw new Error('Not implemented'); }
}
