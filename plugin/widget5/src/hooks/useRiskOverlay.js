import { useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  fetchRiskDetails,
  fetchRiskPoints as fetchRiskPointsData
} from '../services/riskDataService';

const RISK_COLORS = {
  0: '#3498db',
  1: '#f39c12',
  2: '#e74c3c'
};

const RISK_LABELS = {
  0: 'No Risk',
  1: 'Minor Risk',
  2: 'Moderate Risk'
};

const clearTemporaryDataMarkers = (map) => {
  if (!map) {
    return;
  }

  map.eachLayer((layer) => {
    const isCircleMarker = layer instanceof L.CircleMarker && layer.options?.color === '#ff6b35';
    const isPinMarker = layer instanceof L.Marker && layer.options?.title === 'data-source-pin';

    if (isCircleMarker || isPinMarker) {
      map.removeLayer(layer);
    }
  });
};

const createRiskIcon = (point, zoomLevel, isSelected) => {
  const riskLevel = Number.isFinite(point?.riskLevel) ? point.riskLevel : 0;
  const color = RISK_COLORS[riskLevel] || RISK_COLORS[0];
  const isRepresentative = point?.type === 'representative';
  const markerSize = zoomLevel <= 10 ? 20 : 14;
  const outerSize = isRepresentative ? markerSize + 12 : markerSize + 4;
  const ringMarkup = isRepresentative
    ? `<div style="
         position:absolute;
         inset:0;
         border:2px dashed ${color};
         border-radius:999px;
         opacity:${isSelected ? '1' : '0.75'};
       "></div>`
    : '';

  return L.divIcon({
    className: 'risk-point-marker',
    html: `
      <div style="
        position:relative;
        width:${outerSize}px;
        height:${outerSize}px;
      ">
        ${ringMarkup}
        <div style="
          position:absolute;
          top:50%;
          left:50%;
          width:${markerSize}px;
          height:${markerSize}px;
          transform:translate(-50%, -50%);
          border-radius:999px;
          background: white;
          border:${isSelected ? 4 : 3}px solid ${color};
          box-shadow:${isSelected ? `0 0 0 3px ${color}55` : '0 2px 6px rgba(15, 23, 42, 0.35)'};
        "></div>
      </div>
    `,
    iconSize: [outerSize, outerSize],
    iconAnchor: [outerSize / 2, outerSize / 2]
  });
};

export const useRiskOverlay = ({
  mapInstance,
  enabled = true,
  selectedRiskPointId = null,
  setBottomCanvasData,
  setShowBottomCanvas
}) => {
  const layerGroupRef = useRef(null);
  const pointsRef = useRef([]);
  const latestRequestRef = useRef(0);

  useEffect(() => {
    const map = mapInstance?.current;
    if (!map || layerGroupRef.current) {
      return undefined;
    }

    layerGroupRef.current = L.layerGroup().addTo(map);

    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
        layerGroupRef.current = null;
      }
    };
  }, [mapInstance]);

  useEffect(() => {
    const map = mapInstance?.current;
    const layerGroup = layerGroupRef.current;

    if (!map || !layerGroup) {
      return undefined;
    }

    const renderMarkers = () => {
      layerGroup.clearLayers();

      if (!enabled) {
        return;
      }

      const zoomLevel = map.getZoom();
      pointsRef.current.forEach((point) => {
        if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lon)) {
          return;
        }

        const marker = L.marker([point.lat, point.lon], {
          icon: createRiskIcon(point, zoomLevel, point.id === selectedRiskPointId),
          title: `risk-point-${point.id}`,
          bubblingMouseEvents: false
        });

        marker.on('click', async () => {
          clearTemporaryDataMarkers(map);

          const normalizedPoint = {
            ...point
          };

          setBottomCanvasData({
            mode: 'risk',
            point: normalizedPoint,
            status: 'loading'
          });
          setShowBottomCanvas(true);

          try {
            const details = await fetchRiskDetails(point.id);
            setBottomCanvasData({
              mode: 'risk',
              point: normalizedPoint,
              details,
              status: 'success'
            });
            setShowBottomCanvas(true);
          } catch (error) {
            setBottomCanvasData({
              mode: 'risk',
              point: normalizedPoint,
              status: 'error',
              error: error.message
            });
            setShowBottomCanvas(true);
          }
        });

        marker.bindTooltip(
          `${RISK_LABELS[point.riskLevel] || 'Risk'}${point?.maxTWL ? ` | Max TWL ${Number(point.maxTWL).toFixed(2)} m` : ''}`,
          {
            direction: 'top',
            offset: [0, -12]
          }
        );

        marker.addTo(layerGroup);
      });
    };

    const refreshRiskPoints = async () => {
      if (!enabled) {
        pointsRef.current = [];
        renderMarkers();
        return;
      }

      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;

      try {
        const bounds = map.getBounds();
        const bbox = bounds.toBBoxString();
        const zoom = map.getZoom();
        const payload = await fetchRiskPointsData({ zoom, bbox });
        if (latestRequestRef.current !== requestId) {
          return;
        }

        pointsRef.current = Array.isArray(payload?.points)
          ? payload.points
          : [];
        renderMarkers();
      } catch (error) {
        console.error('Failed to fetch risk points:', error);
        pointsRef.current = [];
        renderMarkers();
      }
    };

    refreshRiskPoints();
    map.on('moveend', refreshRiskPoints);
    map.on('zoomend', refreshRiskPoints);

    return () => {
      map.off('moveend', refreshRiskPoints);
      map.off('zoomend', refreshRiskPoints);
    };
  }, [enabled, mapInstance, selectedRiskPointId, setBottomCanvasData, setShowBottomCanvas]);

  useEffect(() => {
    const map = mapInstance?.current;
    const layerGroup = layerGroupRef.current;

    if (!map || !layerGroup || !enabled) {
      return;
    }

    const zoomLevel = map.getZoom();
    layerGroup.eachLayer((layer) => {
      if (!(layer instanceof L.Marker)) {
        return;
      }

      const pointId = Number(String(layer.options?.title || '').replace('risk-point-', ''));
      const matchedPoint = pointsRef.current.find((point) => point.id === pointId);
      if (!matchedPoint) {
        return;
      }

      layer.setIcon(createRiskIcon(matchedPoint, zoomLevel, pointId === selectedRiskPointId));
    });
  }, [enabled, mapInstance, selectedRiskPointId]);
};

export default useRiskOverlay;
