/**
 * Enhanced WMS Tile Loading Service
 * 
 * Provides robust tile loading with intelligent retry strategies,
 * better error categorization, and user-friendly feedback.
 */

class WMSTileLoadingService {
  constructor() {
    this.retryConfig = {
      maxRetries: 6,
      baseDelay: 1000,
      maxDelay: 8000,
      backoffMultiplier: 1.5
    };
    
    this.errorTracking = new Map(); // Track errors per layer
    this.recoveryStrategies = new Map(); // Strategy per layer type
    this.notificationState = new Map(); // Prevent notification spam
  }

  /**
   * Initialize error tracking for a layer
   */
  initializeLayer(layerId, layerName, layerType = 'forecast') {
    this.errorTracking.set(layerId, {
      consecutiveErrors: 0,
      totalErrors: 0,
      lastErrorTime: null,
      recoveryAttempts: 0,
      layerName,
      layerType
    });
    
    this.notificationState.set(layerId, {
      serverErrorNotified: false,
      http2ErrorNotified: false,
      lastNotification: null
    });
  }

  /**
   * Enhanced tile error handler with intelligent recovery
   */
  handleTileError(layerId, tile, error) {
    const errorInfo = this.errorTracking.get(layerId);
    const notifState = this.notificationState.get(layerId);
    
    // DEBUG: Log the actual URL being attempted
    const originalUrl = tile._originalWMSUrl;
    console.log(`🔍 Tile error for ${layerId}: URL = ${originalUrl}`);
    
    if (!errorInfo || !notifState) {
      console.error('Layer not initialized:', layerId);
      return;
    }

    errorInfo.consecutiveErrors++;
    errorInfo.totalErrors++;
    errorInfo.lastErrorTime = Date.now();

    // Store original URL for retry
    if (!tile._originalWMSUrl && tile.src && !tile.src.startsWith('data:')) {
      tile._originalWMSUrl = tile.src;
    }

    // Categorize error type
    const errorCategory = this.categorizeError(errorInfo.layerName, error);
    
    // Store error category for recovery strategy
    errorInfo.errorCategory = errorCategory;
    
    // Handle based on error category and frequency
    this.handleErrorByCategory(layerId, errorCategory, errorInfo, notifState);
    
    // Implement recovery strategy
    this.implementRecoveryStrategy(layerId, tile, errorInfo);
  }

  /**
   * Categorize errors for better handling
   */
  categorizeError(layerName, error) {
    const layerType = this.getLayerType(layerName);
    
    if (layerType === 'limited_temporal') {
      return 'expected_data_gap';
    }
    
    if (layerType === 'static') {
      return 'configuration_issue';
    }
    
    // Check for HTTP/2 protocol errors (Chrome specific)
    if (error && error.target && error.target.src) {
      const errorSrc = error.target.src;
      // HTTP/2 protocol errors often manifest as failed tile loads
      if (errorSrc.includes('cook_forecast') && this.isLikelyHTTP2Error(error)) {
        return 'http2_protocol_error';
      }
    }
    
    // Check error type from HTTP response or network
    if (error && error.target && error.target.status) {
      const status = error.target.status;
      if (status >= 500) return 'server_error';
      if (status === 404) return 'resource_not_found';
      if (status === 403) return 'access_denied';
    }
    
    return 'network_issue';
  }

  /**
   * Detect likely HTTP/2 protocol errors
   */
  isLikelyHTTP2Error(error) {
    // HTTP/2 errors often show up as network errors without status codes
    const target = error.target;
    return target && !target.status && target.src && !target.complete;
  }

  /**
   * Determine layer type from layer name
   */
  getLayerType(layerName) {
    // tpeak is a continuous forecast layer, not limited temporal
    if (layerName.includes('inun')) return 'static';
    return 'forecast'; // All forecast layers including tpeak should be treated consistently
  }

  /**
   * Handle errors based on category and frequency
   */
  handleErrorByCategory(layerId, errorCategory, errorInfo, notifState) {
    const { consecutiveErrors, layerName } = errorInfo;
    
    switch (errorCategory) {
      case 'expected_data_gap':
        if (consecutiveErrors <= 2) {
          console.info(`🌊 ${layerName}: Data not available for current time (normal for limited temporal coverage)`);
        }
        break;
        
      case 'configuration_issue':
        if (consecutiveErrors <= 2) {
          console.warn(`🔧 ${layerName}: Configuration issue detected - checking layer parameters`);
        }
        break;
        
      case 'server_error':
        this.handleServerError(layerId, errorInfo, notifState);
        break;
        
      case 'http2_protocol_error':
        this.handleHTTP2ProtocolError(layerId, errorInfo, notifState);
        break;
        
      case 'network_issue':
      default:
        if (consecutiveErrors <= 3) {
          console.warn(`🌊 Marine forecast: Tile load failed for ${layerName}, implementing recovery strategy`);
        }
        break;
    }
  }

  /**
   * Handle HTTP/2 protocol errors with specific recovery strategies
   */
  handleHTTP2ProtocolError(layerId, errorInfo, notifState) {
    const { consecutiveErrors, layerName } = errorInfo;
    
    // More aggressive retry for HTTP/2 errors (they're often transient)
    if (consecutiveErrors <= 1) {
      console.warn(`🌐 ${layerName}: HTTP/2 protocol issue detected, implementing immediate recovery`);
    } else if (consecutiveErrors === 2 && !notifState.http2ErrorNotified) {
      console.warn(`🌐 ${layerName}: HTTP/2 protocol errors persist. Activating enhanced connection strategy...`);
      notifState.http2ErrorNotified = true;
      
      // Show user-friendly notification for HTTP/2 issues
      this.showUserNotification(layerId, {
        type: 'info',
        message: 'Optimizing marine data connection. Please wait...',
        duration: 2000
      });
    } else if (consecutiveErrors >= 4) {
      console.warn(`🌐 ${layerName}: Critical HTTP/2 protocol failure. Implementing emergency fallback...`);
      
      // Show critical notification
      this.showUserNotification(layerId, {
        type: 'warning',
        message: 'Marine data connection unstable. Using emergency protocols...',
        duration: 4000
      });
    }
  }

  /**
   * Handle server errors with user notifications
   */
  handleServerError(layerId, errorInfo, notifState) {
    const { consecutiveErrors, layerName } = errorInfo;
    
    if (consecutiveErrors >= 5 && !notifState.serverErrorNotified) {
      console.warn(`🌊 ${layerName}: Server connectivity issues detected. Implementing advanced recovery...`);
      notifState.serverErrorNotified = true;
      
      // Show user-friendly notification
      this.showUserNotification(layerId, {
        type: 'warning',
        message: 'Marine data server experiencing connectivity issues. Retrying automatically...',
        duration: 5000
      });
    }
  }

  /**
   * Implement recovery strategy based on error patterns
   */
  implementRecoveryStrategy(layerId, tile, errorInfo) {
    const { consecutiveErrors, recoveryAttempts } = errorInfo;
    const originalUrl = tile._originalWMSUrl;
    
    if (!originalUrl || originalUrl.startsWith('data:')) {
      console.warn(`🌊 Cannot recover tile: No valid WMS URL available`);
      return;
    }

    // Calculate retry delay with exponential backoff
    const delay = Math.min(
      this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, consecutiveErrors - 1),
      this.retryConfig.maxDelay
    );

    // Implement recovery based on error count
    if (consecutiveErrors <= this.retryConfig.maxRetries) {
      const errorCategory = errorInfo.errorCategory || 'network_issue';
      
      // Use much shorter delays for HTTP/2 protocol errors (they're often transient)
      const adjustedDelay = errorCategory === 'http2_protocol_error' ? 
        Math.min(500 + (consecutiveErrors * 200), 1500) : // 500ms, 700ms, 900ms, 1100ms, 1300ms, then cap at 1500ms
        delay;
      
      setTimeout(() => {
        this.retryTileLoad(layerId, tile, originalUrl, recoveryAttempts + 1, errorCategory);
      }, adjustedDelay);
    } else {
      this.handleMaxRetriesExceeded(layerId, tile, errorInfo);
    }
  }

  /**
   * Retry tile loading with enhanced strategies
   */
  async retryTileLoad(layerId, tile, originalUrl, attempt, errorCategory = 'network_issue') {
    const errorInfo = this.errorTracking.get(layerId);
    
    try {
      // Create retry URL with error-category-specific optimizations
      const retryUrl = this.createRetryUrl(originalUrl, attempt, errorCategory);
      
      // Set up promise-based tile loading with timeout for HTTP/2 issues  
      const timeout = errorCategory === 'http2_protocol_error' ? 8000 : 12000;
      await this.loadTileWithPromise(tile, retryUrl, timeout);
      
      // Success - reset error tracking
      this.resetErrorTracking(layerId);
      const safeLayerName = this.getSafeLayerName(errorInfo, layerId);
      console.log(`🌊 ${safeLayerName}: Tile recovery successful after ${attempt} attempts`);
      
    } catch (error) {
      const safeLayerName = this.getSafeLayerName(errorInfo, layerId);
      console.warn(`🌊 ${safeLayerName}: Retry attempt ${attempt} failed`);
      errorInfo.recoveryAttempts = attempt;
      
      // For HTTP/2 errors after multiple failures, try alternative strategies
      if (errorCategory === 'http2_protocol_error' && attempt >= 3) {
        try {
          const safeLayerName = this.getSafeLayerName(errorInfo, layerId);
          console.log(`🔄 ${safeLayerName}: Attempting HTTP/2 alternative strategy`);
          const response = await WMSTileLoadingService.tryAlternativeStrategy(originalUrl);
          
          if (response && response.ok) {
            const blob = await response.blob();
            const objectURL = URL.createObjectURL(blob);
            
            // Clean up any previous object URL to prevent memory leaks
            if (tile._objectURL) {
              URL.revokeObjectURL(tile._objectURL);
            }
            
            tile.src = objectURL;
            tile._objectURL = objectURL; // Store for cleanup
            
            // Success with alternative strategy
            this.resetErrorTracking(layerId);
            console.log(`✅ ${safeLayerName}: HTTP/2 alternative strategy successful`);
            
            // Notify user of successful recovery
            this.showUserNotification(layerId, {
              type: 'success',
              message: 'Marine data connection restored using alternative protocol',
              duration: 3000
            });
            
            return;
          }
        } catch (altError) {
          console.warn(`❌ ${safeLayerName}: Alternative strategy failed:`, altError.message);
        }
      }
      
      // Continue with regular retry mechanism
      if (attempt <= this.retryConfig.maxRetries) {
        setTimeout(() => {
          this.retryTileLoad(layerId, tile, originalUrl, attempt + 1, errorCategory);
        }, this.calculateDelay(attempt, errorCategory));
      }
    }
  }

  /**
   * Calculate retry delay based on attempt number and error category
   */
  calculateDelay(attempt, errorCategory = 'network_issue') {
    // For HTTP/2 errors, use shorter delays
    if (errorCategory === 'http2_protocol_error') {
      const baseDelay = 500; // 500ms base
      const increment = 200; // 200ms increments
      const maxDelay = 1500; // 1.5s max
      return Math.min(baseDelay + (increment * (attempt - 1)), maxDelay);
    }
    
    // Standard exponential backoff for other errors
    const delay = Math.min(
      this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1),
      this.retryConfig.maxDelay
    );
    
    // Add some jitter to prevent thundering herd
    const jitter = Math.random() * 0.3 * delay;
    return Math.floor(delay + jitter);
  }

  /**
   * Try alternative loading strategies for persistent HTTP/2 errors
   */
  static async tryAlternativeStrategy(originalUrl) {
    const strategies = [
      // Strategy 1: Use fetch with HTTP/1.1 headers
      () => this.tryWithHTTP1Headers(originalUrl),
      
      // Strategy 2: Use XMLHttpRequest instead of fetch
      () => this.tryWithXHR(originalUrl),
      
      // Strategy 3: Use absolutely minimal WMS parameters
      () => this.tryMinimalWMS(originalUrl),
      
      // Strategy 4: Try different server parameters
      () => this.tryAlternativeEndpoint(originalUrl)
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        console.log(`🔄 HTTP/2 Alternative Strategy ${i + 1}: Attempting fallback approach`);
        const result = await strategies[i]();
        if (result && result.ok) {
          console.log(`✅ HTTP/2 Alternative Strategy ${i + 1}: Success`);
          return result;
        }
      } catch (error) {
        console.log(`❌ HTTP/2 Alternative Strategy ${i + 1}: Failed -`, error.message);
        continue;
      }
    }
    
    throw new Error('All HTTP/2 alternative strategies failed');
  }

  static async tryWithHTTP1Headers(url) {
    return fetch(url, {
      method: 'GET',
      headers: {
        'Connection': 'close',
        'HTTP2-Settings': 'false',
        'Cache-Control': 'no-cache'
      },
      cache: 'no-cache'
    });
  }

  static async tryWithXHR(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.timeout = 10000;
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({
            ok: true,
            blob: () => Promise.resolve(xhr.response)
          });
        } else {
          reject(new Error(`XHR failed with status ${xhr.status}`));
        }
      };
      
      xhr.onerror = () => reject(new Error('XHR network error'));
      xhr.ontimeout = () => reject(new Error('XHR timeout'));
      xhr.send();
    });
  }

  static async tryMinimalWMS(originalUrl) {
    const url = new URL(originalUrl);
    
    // Keep only absolutely essential WMS parameters
    const essentialParams = {
      service: 'WMS',
      request: 'GetMap',
      version: '1.1.1',
      format: 'image/png',
      transparent: 'true'
    };
    
    // Preserve spatial parameters
    const spatialParams = ['layers', 'width', 'height', 'crs', 'srs', 'bbox'];
    const currentParams = {};
    
    spatialParams.forEach(param => {
      if (url.searchParams.has(param)) {
        currentParams[param] = url.searchParams.get(param);
      }
    });
    
    // Clear all parameters and set minimal set
    url.search = '';
    Object.entries({...essentialParams, ...currentParams}).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    
    return fetch(url.toString());
  }

  static async tryAlternativeEndpoint(originalUrl) {
    const url = new URL(originalUrl);
    
    // Try removing any custom parameters that might cause HTTP/2 issues
    const paramsToRemove = ['time', 'elevation', 'styles', 'colorscalerange', 'abovemaxcolor', 'belowmincolor', 'numcolorbands'];
    paramsToRemove.forEach(param => url.searchParams.delete(param));
    
    // Force HTTP/1.1 compatible format
    url.searchParams.set('format', 'image/png');
    url.searchParams.set('version', '1.1.1');
    
    return fetch(url.toString());
  }

  /**
   * Create retry URL with cache busting and fallback parameters
   */
  createRetryUrl(originalUrl, attempt, errorCategory = 'network_issue') {
    const url = new URL(originalUrl);
    
    // Add cache busting
    url.searchParams.set('_retry', attempt.toString());
    url.searchParams.set('_t', Date.now().toString());
    
    // HTTP/2 specific fallbacks with progressive degradation
    if (errorCategory === 'http2_protocol_error') {
      // Progressive fallback strategy for HTTP/2 issues
      switch (attempt) {
        case 1:
          // First retry: Just cache bust
          break;
          
        case 2:
          // Second retry: Simplify format and exceptions
          url.searchParams.set('format', 'image/png');
          url.searchParams.set('exceptions', 'INIMAGE');
          break;
          
        case 3:
          // Third retry: Remove complex styling
          url.searchParams.delete('styles');
          url.searchParams.set('format', 'image/png');
          url.searchParams.set('version', '1.1.1');
          break;
          
        case 4:
          // Fourth retry: Minimal parameters
          url.searchParams.delete('styles');
          url.searchParams.delete('abovemaxcolor');
          url.searchParams.delete('belowmincolor');
          url.searchParams.delete('numcolorbands');
          url.searchParams.set('format', 'image/png');
          url.searchParams.set('version', '1.1.1');
          break;
          
        default:
          // Final attempts: Absolute minimal WMS request
          const minimalParams = ['service', 'request', 'layers', 'format', 'width', 'height', 'crs', 'bbox', 'version'];
          for (const [key] of url.searchParams) {
            if (!minimalParams.includes(key.toLowerCase())) {
              url.searchParams.delete(key);
            }
          }
          url.searchParams.set('format', 'image/png');
          url.searchParams.set('version', '1.1.1');
          break;
      }
    } else {
      // Standard fallback parameters
      if (attempt > 2) {
        url.searchParams.set('exceptions', 'application/vnd.ogc.se_inimage');
      }
      
      if (attempt > 4) {
        url.searchParams.set('format', 'image/png');
      }
    }
    
    return url.toString();
  }

  /**
   * Load tile with Promise wrapper for better error handling
   */
  loadTileWithPromise(tile, url, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const tempImage = new Image();
      let timeoutId;
      
      // Set up timeout for HTTP/2 protocol issues
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          tempImage.onload = null;
          tempImage.onerror = null;
          reject(new Error('Tile load timeout'));
        }, timeout);
      }
      
      tempImage.onload = () => {
        if (timeoutId) clearTimeout(timeoutId);
        tile.src = url;
        resolve();
      };
      
      tempImage.onerror = (error) => {
        reject(error);
      };
      
      // Set timeout for loading
      setTimeout(() => {
        reject(new Error('Tile load timeout'));
      }, 10000);
      
      tempImage.src = url;
    });
  }

  /**
   * Try alternative recovery strategies
   */
  tryAlternativeStrategy(layerId, tile, originalUrl, attempt) {
    const errorInfo = this.errorTracking.get(layerId);
    
    // Strategy 1: Try different tile format
    if (attempt === 3) {
      console.log(`🌊 ${errorInfo.layerName}: Trying alternative tile format`);
      const altUrl = originalUrl.replace('image/png', 'image/jpeg');
      this.retryTileLoad(layerId, tile, altUrl, attempt);
      return;
    }
    
    // Strategy 2: Try without time dimension for static layers
    if (attempt === 5 && errorInfo.layerType === 'static') {
      console.log(`🌊 ${errorInfo.layerName}: Trying without time dimension`);
      const url = new URL(originalUrl);
      url.searchParams.delete('time');
      this.retryTileLoad(layerId, tile, url.toString(), attempt);
      return;
    }
    
    // Default retry
    setTimeout(() => {
      this.retryTileLoad(layerId, tile, originalUrl, attempt);
    }, this.retryConfig.baseDelay * attempt);
  }

  /**
   * Handle case when max retries exceeded
   */
  handleMaxRetriesExceeded(layerId, tile, errorInfo) {
    const layerName = errorInfo?.layerName || layerId || 'marine forecast';
    console.error(`🌊 ${layerName}: Failed to load tile after ${this.retryConfig.maxRetries} attempts`);
    
    // Show user-friendly production error message
    const userFriendlyMessage = this.getUserFriendlyErrorMessage(layerName);
    
    this.showUserNotification(layerId, {
      type: 'error',
      message: userFriendlyMessage,
      duration: 8000,
      persistent: false // Don't make it persistent to avoid cluttering UI
    });
    
    // Mark layer as problematic
    if (errorInfo) errorInfo.recoveryAttempts = -1; // Mark as failed
  }

  /**
   * Get safe layer name for logging and display
   */
  getSafeLayerName(errorInfo, layerId) {
    return errorInfo?.layerName || layerId || 'marine-layer';
  }

  /**
   * Get user-friendly error message for production
   */
  getUserFriendlyErrorMessage(layerName) {
    const friendlyNames = {
      'dirm': 'Wave Direction',
      'hs': 'Significant Wave Height', 
      'tm02': 'Wave Period',
      'tpeak': 'Peak Wave Period',
      'cook_forecast': 'Cook Islands Forecast'
    };

    const displayName = friendlyNames[layerName] || 'Marine Data';
    
    return `${displayName} temporarily unavailable. The system is working to restore the connection.`;
  }

  /**
   * Reset error tracking on successful load
   */
  resetErrorTracking(layerId) {
    const errorInfo = this.errorTracking.get(layerId);
    const notifState = this.notificationState.get(layerId);
    
    if (errorInfo) {
      errorInfo.consecutiveErrors = 0;
      errorInfo.recoveryAttempts = 0;
    }
    
    if (notifState) {
      notifState.serverErrorNotified = false;
      notifState.http2ErrorNotified = false;
    }
  }

  /**
   * Show user notification (can be overridden for different UI frameworks)
   */
  showUserNotification(layerId, options) {
    if (typeof window !== 'undefined' && window.showNotification) {
      window.showNotification(options.message, options.type, options.duration);
    } else {
      // Fallback to console
      console.log(`📢 ${options.type.toUpperCase()}: ${options.message}`);
    }
  }

  /**
   * Get layer statistics for monitoring
   */
  getLayerStats(layerId) {
    return this.errorTracking.get(layerId) || null;
  }

  /**
   * Get overall service health
   */
  getServiceHealth() {
    const stats = {
      totalLayers: this.errorTracking.size,
      healthyLayers: 0,
      problematicLayers: 0,
      failedLayers: 0
    };
    
    for (const errorInfo of this.errorTracking.values()) {
      if (errorInfo.recoveryAttempts === -1) {
        stats.failedLayers++;
      } else if (errorInfo.consecutiveErrors > 3) {
        stats.problematicLayers++;
      } else {
        stats.healthyLayers++;
      }
    }
    
    return stats;
  }
}

// Create singleton instance
const wmsTileLoadingService = new WMSTileLoadingService();

export default wmsTileLoadingService;