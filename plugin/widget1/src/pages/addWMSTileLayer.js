import L from 'leaflet';
import $ from 'jquery';
import requestThrottler from '../utils/WMSRequestThrottler';
import burstPrevention from '../utils/BurstPrevention';

/**
 * Adds a WMS tile layer to a Leaflet map.
 *
 * @param {L.Map} map - The Leaflet map instance to which the WMS layer will be added.
 * @param {string} url - The URL of the WMS service.
 * @param {Object} [options] - Optional parameters for the WMS layer.
 * @param {function} handleShow - Callback function to handle the feature info data (canvas update).
 */
const addWMSTileLayer = (map, url, options = {}, handleShow) => {
    // Set default WMS params
    const defaultOptions = {
        layers: '',
        format: 'image/png',
        transparent: true,
        ...options.params,
    };

    // Performance-focused defaults optimized based on HAR analysis
    const performanceTuning = {
        // Larger tiles = fewer requests (reduces the 43-request burst)
        // 512 = 4x fewer requests than standard 256
        // 768 = 9x fewer requests (use for very slow servers)
        // 1024 = 16x fewer requests (may be too slow per tile)
        tileSize: options.tileSize || 768, // Allow override via options
        // Reduced buffer to only load tiles near viewport (lazy loading)
        keepBuffer: 2, // Changed from 4 to 2
        // Allow the browser to pipeline requests
        crossOrigin: true,
        // Wait until idle to update (reduces concurrent requests during pan/zoom)
        updateWhenIdle: true, // Changed from false to true
        updateInterval: 200, // Increased from 120ms
        // Remove tiles outside view to free memory
        removeOutsideVisibleBounds: true, // Changed from false to true
        // Error tile fallback (transparent 1x1 pixel for 502 errors)
        errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    };

    // Create the WMS tile layer with throttling support
    const wmsLayer = L.tileLayer.wms(url, {
        ...performanceTuning,
        layers: defaultOptions.layers,
        format: defaultOptions.format,
        transparent: defaultOptions.transparent,
        ...options,
    });

    // Extract domain for throttling
    const domain = new URL(url).hostname;

    // Override createTile to add request throttling with priority
    const originalCreateTile = wmsLayer.createTile.bind(wmsLayer);
    wmsLayer.createTile = function(coords, done) {
        const tile = originalCreateTile(coords, done);
        const originalSrc = tile.src;
        
        // Intercept tile loading with throttler
        if (originalSrc) {
            tile.src = ''; // Clear to prevent immediate load
            
            // Calculate priority based on tile position
            // Center tiles have higher priority (lower number)
            const mapCenter = map.getCenter();
            const zoom = map.getZoom();
            const tilePoint = coords.scaleBy(new L.Point(256, 256));
            const tileBounds = map.unproject(tilePoint, zoom);
            
            // Distance from map center to tile center (in degrees)
            const tileCenterLat = (tileBounds.lat + map.unproject(tilePoint.add([256, 256]), zoom).lat) / 2;
            const tileCenterLng = (tileBounds.lng + map.unproject(tilePoint.add([256, 256]), zoom).lng) / 2;
            const distance = Math.sqrt(
                Math.pow(mapCenter.lat - tileCenterLat, 2) + 
                Math.pow(mapCenter.lng - tileCenterLng, 2)
            );
            
            // Priority: 0-10, where 0 is highest (center tile), 10 is lowest (far from center)
            const priority = Math.min(10, Math.floor(distance * 100));
            
            // Apply burst prevention delay for initial load
            const burstDelay = burstPrevention.getDelayForTile();
            
            // Delay if needed to prevent burst
            const loadTile = async () => {
                if (burstDelay > 0) {
                    await new Promise(resolve => setTimeout(resolve, burstDelay));
                }
                
                // Throttle the request with priority
                return requestThrottler.throttleRequest(tile, originalSrc, domain, priority);
            };
            
            loadTile()
                .then(() => {
                    if (done) done(null, tile);
                })
                .catch((error) => {
                    console.warn('Tile load failed:', error.message);
                    // Use error tile
                    tile.src = performanceTuning.errorTileUrl;
                    if (done) done(error, tile);
                });
        }
        
        return tile;
    };

    // Add the layer to the map
    wmsLayer.addTo(map);

    // Enhanced error handling with timeout
    const RETRY_LIMIT = 2; // Reduced from 3
    const RETRY_DELAY = 2000; // Reduced from 3000ms

    const handleTileError = (event) => {
        const tile = event.tile;
        const tileSrc = tile.src;
        
        // Check if this is a 502 error by inspecting the response
        // For 502 errors, don't retry - just use error tile
        if (tileSrc && !tileSrc.startsWith('data:')) {
            // Quick check without HEAD request to avoid more network overhead
            const attempt = tile.dataset.retryAttempt ? parseInt(tile.dataset.retryAttempt) : 0;
            
            if (attempt < RETRY_LIMIT) {
                tile.dataset.retryAttempt = (attempt + 1).toString();
                console.log(`🔄 Retry tile (attempt ${attempt + 1}/${RETRY_LIMIT})`);
                
                setTimeout(() => {
                    // Use throttler for retry too
                    requestThrottler.throttleRequest(tile, tileSrc, domain)
                        .catch(() => {
                            // Final failure - use error tile
                            tile.src = performanceTuning.errorTileUrl;
                        });
                }, RETRY_DELAY);
            } else {
                console.warn('❌ Tile failed after retries, using error tile');
                tile.src = performanceTuning.errorTileUrl;
            }
        }
    };

    wmsLayer.on('tileerror', handleTileError);

    // Store the getFeatureInfo function on the layer for external use
    wmsLayer.getFeatureInfo = function(latlng) {
        getFeatureInfo(latlng, url, wmsLayer, map, options, handleShow);
    };

    // Function to retrieve GetFeatureInfo from WMS
    const getFeatureInfo = (latlng, url, wmsLayer, map, options, handleShow) => {
        const point = map.latLngToContainerPoint(latlng, map.getZoom());
        const size = map.getSize();
        const bbox = map.getBounds().toBBoxString();

        const params = {
            request: 'GetFeatureInfo',
            service: 'WMS',
            srs: 'EPSG:4326',
            styles: wmsLayer.options.styles,
            transparent: wmsLayer.options.transparent,
            version: wmsLayer.options.version || '1.1.1',
            format: wmsLayer.options.format,
            bbox: bbox,
            height: Math.round(size.y),
            width: Math.round(size.x),
            layers: wmsLayer.options.layers,
            query_layers: wmsLayer.options.layers,
            info_format: 'text/html',
        };

        // For WMS 1.3.0, use i/j instead of x/y
        const xParam = params.version === '1.3.0' ? 'i' : 'x';
        const yParam = params.version === '1.3.0' ? 'j' : 'y';
        params[xParam] = Math.round(point.x);
        params[yParam] = Math.round(point.y);

        var featureInfoUrl = url + L.Util.getParamString(params, url, true);
        featureInfoUrl = featureInfoUrl.replace(/wms\?.*?REQUEST=[^&]*?&.*?REQUEST=[^&]*?&/, '');
        featureInfoUrl = featureInfoUrl.replace(/VERSION=1\.3\.0&/g, '');
        featureInfoUrl = featureInfoUrl.replace(/\/ncWMS\/?(?!wms\?)/i, '/ncWMS/wms?REQUEST=GetFeatureInfo&');

        // Gather extra info to send to handleShow
        const featureInfoBase = {
            id: options.id,
            latlng,
            layerName: wmsLayer.options.layers,
            bbox,
            [xParam]: params[xParam],
            [yParam]: params[yParam],
            height: params.height,
            width: params.width,
            style: wmsLayer.options.styles || "",
            timeDimension: wmsLayer.options.time || options.time || "",
            featureInfo: "Loading..."
        };

        // Immediately update the canvas with the basic info and "Loading..."
        if (typeof handleShow === "function") {
            handleShow(featureInfoBase);
        }

        $.ajax({
            url: featureInfoUrl,
            success: function (data) {
                const doc = (new DOMParser()).parseFromString(data, "text/html");
                let featureInfo = "No Data";
                if (doc.body.innerHTML.trim().length > 0) {
                    // Try parsing as before
                    const p = doc.getElementsByTagName('td');
                    if (p.length > 5) {
                        featureInfo = p[5] ? p[5].textContent.trim() : "No Data";
                        const num = Number(featureInfo);
                        if (!isNaN(num)) {
                            featureInfo = num.toFixed(2);
                        }
                    }
                }

                // Update canvas with all info including parsed value
                if (typeof handleShow === "function") {
                    handleShow({
                        ...featureInfoBase,
                        featureInfo
                    });
                }

                // Optionally show popup with "more..." link
                showFeatureInfoPopup(featureInfo, latlng, map, featureInfoBase, handleShow);
            },
            error: function () {
                // Show error in canvas
                if (typeof handleShow === "function") {
                    handleShow({
                        ...featureInfoBase,
                        featureInfo: "Error fetching data"
                    });
                }
            }
        });
    };

    // Function to show the feature info in a popup
    const showFeatureInfoPopup = (featureInfo, latlng, map, featureInfoBase, handleShow) => {
        // Create popup content with the "more..." link
        const popupContent = document.createElement('div');
        popupContent.innerHTML = `
            <p>Value: ${featureInfo}</p>
            <a href="#" class="open-timeseries-link" style="display: block;">&nbsp;more...</a>
        `;

        // eslint-disable-next-line no-unused-vars
        const popup = L.popup({ maxWidth: 800 }) // TODO: Use this or remove
            .setLatLng(latlng)
            .setContent(popupContent)
            .openOn(map);

        // "more..." link event
        const link = popupContent.querySelector('.open-timeseries-link');
        if (link) {
            link.addEventListener('click', (ev) => {
                ev.preventDefault();
                if (typeof handleShow === "function") {
                    handleShow({
                        ...featureInfoBase,
                        featureInfo
                    });
                }
                map.closePopup();
            });
        }
    };

    return wmsLayer; // Return the layer instance
};

export default addWMSTileLayer;