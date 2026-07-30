import { useRef, useState } from 'react';
import {
  X, Plus, Trash2,
  Save, ChevronUp, ChevronDown,
  AlertTriangle, CheckCircle,
  Undo2, Redo2, RotateCcw, Download, Upload,
} from 'lucide-react';
import { INUNDATION_PALETTE_OPTIONS } from '../config/inundationThresholds';

/**
 * InundationThresholdEditor
 *
 * Slide-over panel for customising inundation depth severity bands.
 * Driven entirely by the useInundationThresholds hook — this component
 * is pure presentation and has no internal state beyond local UI flags.
 */
export default function InundationThresholdEditor({
  isOpen,
  onClose,
  categories,
  paletteId,
  minVisibleDepth,
  validationErrors,
  isDirty,
  savedAt,
  saveError,
  canUndo,
  canRedo,
  updateRow,
  addRow,
  removeRow,
  moveRow,
  updateMinVisibleDepth,
  undo,
  redo,
  applyPalette,
  save,
  resetToDefaults,
  exportJson,
  importJson,
}) {
  const [saveFlash, setSaveFlash] = useState(false);
  const [localSaveError, setLocalSaveError] = useState(null);
  const fileInputRef = useRef(null);

  if (!isOpen) return null;

  const isValid = validationErrors.length === 0;
  const paletteMeta = INUNDATION_PALETTE_OPTIONS.find((option) => option.id === paletteId)
    || INUNDATION_PALETTE_OPTIONS[0];
  const depthMin = categories[0]?.thresholdM ?? 0;
  const depthMax = categories[categories.length - 1]?.thresholdM ?? 0;
  const minVisibleDepthCm = Math.round(minVisibleDepth * 100);
  const savedAtLabel = savedAt
    ? new Date(savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : 'Not saved yet';

  const handleSave = () => {
    setLocalSaveError(null);
    const result = save();
    if (result.ok) {
      setSaveFlash(true);
      setTimeout(() => setSaveFlash(false), 1800);
    } else {
      console.error('[InundationThresholdEditor] Save failed:', result.error);
      setLocalSaveError(result.error);
    }
  };

  const activeSaveError = localSaveError || saveError;

  const handleImportChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLocalSaveError(null);
    const result = await importJson(file);
    if (!result.ok) {
      console.error('[InundationThresholdEditor] Import failed:', result.errors);
      setLocalSaveError(result.errors?.join(' ') || 'Import failed.');
    }
    event.target.value = '';
  };

  return (
    <>
      <div className="ite-backdrop" onClick={onClose} aria-hidden="true" />

      <div className="ite-panel" role="dialog" aria-modal="true" aria-label="Inundation threshold editor">

        {/* Header */}
        <div className="ite-header">
          <div className="ite-header__title">
            <span className="ite-header__icon">🌊</span>
            <div>
              <div className="ite-header__name">Inundation Thresholds</div>
              <div className="ite-header__sub">
                Edit depth values, labels, colors, and descriptions
              </div>
            </div>
          </div>
          <button className="ite-icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="ite-toolbar">
          <div className="ite-toolbar__left">
            <span className="ite-footer__saved">Last saved: {savedAtLabel}</span>
          </div>
          <div className="ite-toolbar__right">
            <button
              className="ite-icon-btn"
              onClick={undo}
              disabled={!canUndo}
              title="Undo"
            >
              <Undo2 size={14} />
            </button>
            <button
              className="ite-icon-btn"
              onClick={redo}
              disabled={!canRedo}
              title="Redo"
            >
              <Redo2 size={14} />
            </button>
            <button
              className="ite-icon-btn ite-icon-btn--warn"
              onClick={resetToDefaults}
              title="Revert to defaults"
            >
              <RotateCcw size={14} />
            </button>
            <button
              className="ite-icon-btn"
              onClick={exportJson}
              title="Export thresholds"
            >
              <Download size={14} />
            </button>
            <button
              className="ite-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Import thresholds"
            >
              <Upload size={14} />
            </button>
            <button
              className={`ite-btn-save ${saveFlash ? 'ite-btn-save--flash' : ''}`}
              onClick={handleSave}
              disabled={!isValid}
              title={!isValid ? 'Fix errors before saving' : 'Save thresholds to browser storage'}
            >
              <Save size={14} />
              {saveFlash ? 'Saved' : 'Save'}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="ite-hidden-file-input"
            onChange={handleImportChange}
          />
        </div>

        {/* Validation banner */}
        {!isValid && (
          <div className="ite-validation-banner">
            <AlertTriangle size={15} />
            <div>{validationErrors.map((e, i) => <div key={i}>{e}</div>)}</div>
          </div>
        )}
        {isValid && isDirty && !activeSaveError && (
          <div className="ite-info-banner">
            <CheckCircle size={14} />
            <span>Map, legend, chart labels, and point forecast text use these editable bands.</span>
          </div>
        )}

        {/* Table */}
        <div className="ite-body">
          <div className="ite-summary-row">
            <span className="ite-summary-pill">Palette: {paletteMeta.label}</span>
            <span className="ite-summary-pill">Bands: {categories.length}</span>
            <span className="ite-summary-pill">Editable labels and notes</span>
            <span className="ite-summary-pill">Range: {depthMin}m to {depthMax}m</span>
            <span className="ite-summary-pill">Hide below: {minVisibleDepthCm}cm</span>
          </div>
          <div className="ite-cutoff-row">
            <div className="ite-cutoff-row__meta">
              <label className="ite-palette-row__label" htmlFor="inundation-min-visible-depth">Hide below depth</label>
              <span className="ite-palette-row__desc">Suppress shallow model noise before raster rendering.</span>
            </div>
            <div className="ite-cutoff-row__control">
              <input
                id="inundation-min-visible-depth"
                type="number"
                min={0}
                max={1}
                step={0.01}
                className="ite-number-input ite-number-input--compact"
                value={minVisibleDepth}
                onChange={(e) => updateMinVisibleDepth(e.target.value)}
                aria-label="Minimum visible inundation depth in metres"
              />
              <span className="ite-cutoff-row__unit">m</span>
            </div>
          </div>
          <div className="ite-palette-row">
            <div className="ite-palette-row__meta">
              <label className="ite-palette-row__label" htmlFor="inundation-palette-select">Color palette</label>
              <span className="ite-palette-row__desc">{paletteMeta.description}</span>
            </div>
            <select
              id="inundation-palette-select"
              className="ite-palette-select"
              value={paletteId}
              onChange={(e) => applyPalette(e.target.value)}
            >
              {INUNDATION_PALETTE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {`${option.label} - ${option.description}`}
                </option>
              ))}
            </select>
          </div>
          <div className="ite-table-header">
            <span style={{ gridColumn: '1 / 4' }}>Color and threshold</span>
            <span style={{ gridColumn: '4 / 6' }}>Label and description</span>
            <span style={{ justifySelf: 'end' }}>Del</span>
          </div>

          {categories.map((cat, idx) => (
            <div key={cat.id} className="ite-row">
              <div className="ite-row__order">
                <button
                  className="ite-micro-btn"
                  onClick={() => moveRow(cat.id, -1)}
                  disabled={idx === 0}
                  title="Move up"
                >
                  <ChevronUp size={11} />
                </button>
                <button
                  className="ite-micro-btn"
                  onClick={() => moveRow(cat.id, 1)}
                  disabled={idx === categories.length - 1}
                  title="Move down"
                >
                  <ChevronDown size={11} />
                </button>
              </div>

              <div className="ite-row__color-cell">
                <input
                  type="color"
                  id={`ite-color-${cat.id}`}
                  name={`ite-color-${cat.id}`}
                  className="ite-color-input"
                  value={cat.color}
                  onChange={(e) => updateRow(cat.id, 'color', e.target.value)}
                  title={`Color for ${cat.label}`}
                />
                <div className="ite-color-swatch" style={{ backgroundColor: cat.color }} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <input
                  type="number"
                  id={`ite-threshold-${cat.id}`}
                  name={`ite-threshold-${cat.id}`}
                  className="ite-number-input"
                  value={cat.thresholdM}
                  min={0}
                  step={0.05}
                  onChange={(e) => updateRow(cat.id, 'thresholdM', e.target.value)}
                  aria-label={`Depth for ${cat.label} in metres`}
                />
                <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', fontWeight: 600 }}>m</span>
              </div>

              <input
                type="text"
                id={`ite-label-${cat.id}`}
                name={`ite-label-${cat.id}`}
                className="ite-text-input ite-text-input--label"
                value={cat.label}
                maxLength={40}
                onChange={(e) => updateRow(cat.id, 'label', e.target.value)}
                placeholder="Category label"
              />

              <textarea
                id={`ite-desc-${cat.id}`}
                name={`ite-desc-${cat.id}`}
                className="ite-text-input ite-textarea ite-textarea--desc"
                value={cat.description}
                maxLength={120}
                rows={2}
                onChange={(e) => updateRow(cat.id, 'description', e.target.value)}
                placeholder="Operational impact"
              />

              <div className="ite-row__actions">
                <button
                  className="ite-micro-btn ite-micro-btn--danger"
                  onClick={() => removeRow(cat.id)}
                  disabled={categories.length <= 2}
                  title="Remove band"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="ite-footer">
          <button className="ite-btn-add" onClick={addRow}>
            <Plus size={14} /> Add band
          </button>
        </div>
      </div>
    </>
  );
}
