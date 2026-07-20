import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  HelpCircle,
  Layers,
  MapPin,
  MousePointer2,
  PlayCircle,
  Route,
  Ship,
  Sparkles,
  X,
} from 'lucide-react';
import './UserGuide.css';

const WORKFLOW_PHASES = [
  { label: 'Layer', id: 'layers' },
  { label: 'Time', id: 'time' },
  { label: 'Place', id: 'inspect' },
  { label: 'Decision', id: 'suitability' },
  { label: 'Output', id: 'advisory' },
];

const QUICK_STARTS = [
  {
    title: 'Review the sea state',
    text: 'Start with wave height and the timeline before inspecting points.',
    action: { type: 'layer', value: 'hs' },
    icon: Layers,
  },
  {
    title: 'Check a landing',
    text: 'Jump straight to vessel suitability and landing-area tools.',
    action: { type: 'suitabilityTab', value: 'landing' },
    icon: MapPin,
  },
  {
    title: 'Plan a route',
    text: 'Open route drawing/import, departure time, and speed controls.',
    action: { type: 'suitabilityTab', value: 'route' },
    icon: Route,
  },
  {
    title: 'Prepare a PDF',
    text: 'Open the advisory workflow for the selected vessel and scope.',
    action: { type: 'suitabilityTab', value: 'advisory' },
    icon: FileText,
  },
];

const GUIDE_SECTIONS = [
  {
    id: 'layers',
    title: 'Choose a forecast layer',
    kicker: 'Start here',
    icon: Layers,
    actionLabel: 'Show wave layers',
    action: { type: 'layer', value: 'hs' },
    outcome: 'A focused map layer, matching legend, and the correct point data when you click the map.',
    bestFor: 'Choosing what question the map should answer first.',
    checklist: ['Layer selected', 'Legend visible', 'Opacity adjusted'],
    next: 'Move through time before making a decision from one frame.',
    items: [
      'Use Forecast Variables to switch between wave height, period, inundation, and vessel suitability.',
      'The map legend changes with the selected layer and the opacity slider controls how strongly it covers the basemap.',
      'Use the basemap control (top-left, below the zoom buttons) to switch the map background between Satellite, Street, and Dark.',
    ],
  },
  {
    id: 'time',
    title: 'Move through time',
    kicker: 'Forecast window',
    icon: Clock3,
    actionLabel: 'Open time controls',
    action: { type: 'timeline' },
    outcome: 'The map, legend, landing charts, and advisory context all follow the selected forecast timestep.',
    bestFor: 'Comparing windows before departure or landing.',
    checklist: ['Correct local/UTC time', 'Forecast age checked', 'Animation paused on decision time'],
    next: 'Inspect a point, landing area, or route at the selected time.',
    items: [
      'Use the timeline to step, play, or jump through the forecast window.',
      'Switch between NUT and UTC when you need local operational timing or source-time checks.',
    ],
  },
  {
    id: 'inspect',
    title: 'Inspect the map',
    kicker: 'Point check',
    icon: MousePointer2,
    actionLabel: 'Use point inspect',
    action: { type: 'suitabilityTab', value: 'point' },
    outcome: 'A bottom panel with tabular values and time-series context for the clicked location.',
    bestFor: 'Checking one exact map point quickly.',
    checklist: ['Point is offshore/in-mesh', 'Tabular values loaded', 'Timeseries trend reviewed'],
    next: 'Switch to vessel suitability if this point supports a go/no-go decision.',
    items: [
      'Click the map to open the tabular and timeseries panel for the selected location.',
      'If a point is outside the valid marine mesh, the app will show unavailable rather than filling in a safe value.',
    ],
  },
  {
    id: 'suitability',
    title: 'Use vessel suitability',
    kicker: 'Boat class',
    icon: Ship,
    actionLabel: 'Show suitability',
    action: { type: 'layer', value: 'suitability' },
    outcome: 'A vessel-specific Suitable, Caution, or Avoid map for the selected forecast time.',
    bestFor: 'Turning sea-state data into operational planning language.',
    checklist: ['Vessel class selected', 'Hazard colours understood', 'Warnings treated conservatively'],
    next: 'Use Landing for a launch site, Route for a transit, or Advisory for a PDF brief.',
    items: [
      'Select the vessel class first; point, landing, route, and advisory tools all use that class.',
      'Suitable, Caution, and Avoid are forecast classes for planning support, not a replacement for local judgement.',
      'If the map shows one solid colour, click the small info button next to the legend title — it confirms the exact coverage percentage so a uniform hazard reads as a real forecast, not a broken display.',
    ],
  },
  {
    id: 'landing',
    title: 'Check landing areas',
    kicker: 'Launch decision',
    icon: MapPin,
    actionLabel: 'Open landing tool',
    action: { type: 'suitabilityTab', value: 'landing' },
    outcome: 'A landing assessment, comparison heatmap, and chart showing class changes through time.',
    bestFor: 'Canoe, small-boat, and launch-area planning.',
    checklist: ['Landing location selected', '500 m basis/fallback checked', 'Best and avoid windows reviewed'],
    next: 'Generate a landing advisory PDF once the site and vessel are correct.',
    items: [
      'Use Landing to select a launch area or click a custom location.',
      'Landing charts show how suitability changes over time and label whether the data is 500 m area-based or a fallback.',
    ],
  },
  {
    id: 'route',
    title: 'Plan a route',
    kicker: 'Transit decision',
    icon: Route,
    actionLabel: 'Open route tool',
    action: { type: 'suitabilityTab', value: 'route' },
    outcome: 'A route summary, coloured route segments, and worst-condition recommendation.',
    bestFor: 'Checking if a planned passage is acceptable for a vessel class.',
    checklist: ['Route has at least two points', 'Departure and speed set', 'Worst segment reviewed'],
    next: 'Save scenarios if comparing departure times, vessels, or route alternatives.',
    items: [
      'Use Route to draw waypoints or import GPX/GeoJSON, then choose departure time and speed.',
      'The route forecast samples conditions along the path and highlights the worst suitability class encountered.',
    ],
  },
  {
    id: 'advisory',
    title: 'Create advisory PDFs',
    kicker: 'Shareable output',
    icon: FileText,
    actionLabel: 'Open advisory tool',
    action: { type: 'suitabilityTab', value: 'advisory' },
    outcome: 'A PDF brief for the domain, a landing area, a route, or a scenario comparison.',
    bestFor: 'Briefing stakeholders or keeping a planning record.',
    checklist: ['Scope selected', 'Vessel and time verified', 'Fallback/unverified notes reviewed'],
    next: 'Use the PDF as a planning brief, not as a replacement for official warnings.',
    items: [
      'Use Advisory to generate a PDF for the current vessel and selected scope.',
      'Landing and route advisories include extra operational context when those tools have been configured first.',
    ],
  },
];

export default function UserGuide({ isOpen, onClose, onAction }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [completedIds, setCompletedIds] = useState(() => new Set());
  const activeSection = GUIDE_SECTIONS[activeIndex] ?? GUIDE_SECTIONS[0];
  const ActiveIcon = activeSection.icon;
  const activePhaseIndex = Math.max(0, WORKFLOW_PHASES.findIndex((phase) => phase.id === activeSection.id));
  const progress = useMemo(() => (
    Math.round((completedIds.size / GUIDE_SECTIONS.length) * 100)
  ), [completedIds]);

  const handleOverlayClick = useCallback((event) => {
    if (event.target === event.currentTarget) onClose?.();
  }, [onClose]);

  const markDone = useCallback((id = activeSection.id) => {
    setCompletedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, [activeSection.id]);

  const handleAction = useCallback(() => {
    markDone(activeSection.id);
    onAction?.(activeSection.action);
  }, [activeSection, markDone, onAction]);

  const handleQuickStart = useCallback((action) => {
    onAction?.(action);
  }, [onAction]);

  const goTo = useCallback((nextIndex) => {
    setActiveIndex(Math.max(0, Math.min(GUIDE_SECTIONS.length - 1, nextIndex)));
  }, []);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
      if (event.key === 'ArrowRight') goTo(activeIndex + 1);
      if (event.key === 'ArrowLeft') goTo(activeIndex - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, goTo, isOpen, onClose]);

  useEffect(() => {
    if (isOpen) setActiveIndex(0);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="user-guide-overlay" onMouseDown={handleOverlayClick} role="presentation">
      <section
        className="user-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-guide-title"
        aria-describedby="user-guide-summary"
      >
        <header className="user-guide__header">
          <div className="user-guide__title-wrap">
            <span className="user-guide__icon" aria-hidden="true"><HelpCircle size={20} /></span>
            <div>
              <div className="user-guide__eyebrow">Optional help</div>
              <h2 id="user-guide-title">User guide</h2>
            </div>
          </div>
          <button type="button" className="user-guide__close" onClick={onClose} aria-label="Close user guide">
            <X size={20} />
          </button>
        </header>

        <div className="user-guide__intro">
          <div>
            <div className="user-guide__hero-badge">
              <Sparkles size={14} />
              Operational guide
            </div>
            <p id="user-guide-summary" className="user-guide__summary">
              Pick a mission, follow the decision flow, and jump directly into the live controls. Built for fast orientation during a real forecast review.
            </p>
          </div>
          <div className="user-guide__progress" aria-label={`Guide progress ${progress}%`}>
            <div className="user-guide__progress-meta">
              <span>{completedIds.size} of {GUIDE_SECTIONS.length} done</span>
              <strong>{progress}%</strong>
            </div>
            <div className="user-guide__progress-track">
              <span style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>

        <div className="user-guide__flow" aria-label="Forecast workflow">
          {WORKFLOW_PHASES.map((phase, index) => {
            const isActive = index === activePhaseIndex;
            const isPast = index < activePhaseIndex;
            return (
              <button
                key={phase.id}
                type="button"
                className={`user-guide__flow-step${isActive ? ' user-guide__flow-step--active' : ''}${isPast ? ' user-guide__flow-step--past' : ''}`}
                onClick={() => {
                  const sectionIndex = GUIDE_SECTIONS.findIndex((section) => section.id === phase.id);
                  if (sectionIndex >= 0) setActiveIndex(sectionIndex);
                }}
              >
                <span>{index + 1}</span>
                {phase.label}
              </button>
            );
          })}
        </div>

        <div className="user-guide__quick-starts" aria-label="Quick start workflows">
          {QUICK_STARTS.map(({ title, text, action, icon: Icon }) => (
            <button
              key={title}
              type="button"
              className="user-guide__mission"
              onClick={() => handleQuickStart(action)}
            >
              <span className="user-guide__mission-icon"><Icon size={18} /></span>
              <span className="user-guide__mission-copy">
                <strong>{title}</strong>
                <span>{text}</span>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>

        <div className="user-guide__interactive">
          <nav className="user-guide__nav" aria-label="Guide sections">
            {GUIDE_SECTIONS.map(({ id, title, icon: Icon }, index) => {
              const isActive = index === activeIndex;
              const isDone = completedIds.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={`user-guide__nav-btn${isActive ? ' user-guide__nav-btn--active' : ''}${isDone ? ' user-guide__nav-btn--done' : ''}`}
                  aria-current={isActive ? 'step' : undefined}
                  onClick={() => setActiveIndex(index)}
                >
                  <Icon size={16} />
                  <span>{title}</span>
                  {isDone && <span className="user-guide__done-mark" aria-label="Completed">Done</span>}
                </button>
              );
            })}
          </nav>

          <article className="user-guide__step">
            <div className="user-guide__step-title">
              <span className="user-guide__step-icon"><ActiveIcon size={22} /></span>
              <div>
                <div className="user-guide__step-count">{activeSection.kicker} · Step {activeIndex + 1} of {GUIDE_SECTIONS.length}</div>
                <h3>{activeSection.title}</h3>
              </div>
            </div>
            <div className="user-guide__outcome-grid">
              <div>
                <span>Best for</span>
                <strong>{activeSection.bestFor}</strong>
              </div>
              <div>
                <span>Expected output</span>
                <strong>{activeSection.outcome}</strong>
              </div>
            </div>
            <div className="user-guide__step-body">
              <div className="user-guide__guidance">
                <h4>How to use it</h4>
                <ul>
                  {activeSection.items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
              <aside className="user-guide__coach" aria-label="Operator checklist">
                <h4>Operator checks</h4>
                <div className="user-guide__checks">
                  {activeSection.checklist.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="user-guide__check"
                      onClick={() => markDone(activeSection.id)}
                    >
                      <CheckCircle2 size={15} />
                      {item}
                    </button>
                  ))}
                </div>
                <div className="user-guide__next">
                  <span>Next best step</span>
                  <strong>{activeSection.next}</strong>
                </div>
              </aside>
            </div>

            <div className="user-guide__actions">
              <button type="button" className="user-guide__primary-action" onClick={handleAction}>
                <PlayCircle size={16} />
                {activeSection.actionLabel}
              </button>
              <button type="button" className="user-guide__secondary-action" onClick={() => markDone(activeSection.id)}>
                <CheckCircle2 size={16} />
                Mark done
              </button>
            </div>

            <div className="user-guide__pager">
              <button type="button" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0}>
                Previous
              </button>
              <button type="button" onClick={() => goTo(activeIndex + 1)} disabled={activeIndex === GUIDE_SECTIONS.length - 1}>
                Next
              </button>
            </div>
          </article>
        </div>

        <footer className="user-guide__footer">
          Forecast guidance is decision-support information. Always combine it with official advice, local observations, and operational judgement.
        </footer>
      </section>
    </div>
  );
}
