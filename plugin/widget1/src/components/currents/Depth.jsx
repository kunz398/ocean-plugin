import { useEffect, useRef } from 'react';
import './currents.css';

// Fallback shown while the real depth coordinate is still loading (or for a
// layer with no depth axis) — matches Niue's actual CROCO depth levels once
// depthLevels arrives, so there's no visible jump when it does.
const FALLBACK_DEPTH_LEVELS = [-5, -10, -20, -30, -50, -100, -300, -500, -1000];

const DEPTH_ZONES = {
  5: 'euphotic zone', 10: 'euphotic zone', 20: 'euphotic zone', 30: 'euphotic zone',
  50: 'mesopelagic zone', 100: 'mesopelagic zone', 300: 'bathypelagic zone',
  500: 'bathypelagic zone', 1000: 'abyssal zone',
};

const DEPTH_COLORS = [
  [14, 120, 180], [12, 100, 155], [10, 82, 132], [8, 65, 112],
  [6, 50, 95], [4, 38, 75], [3, 28, 58], [2, 20, 45], [1, 12, 30],
];

function findNearestIndex(values, target) {
  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < values.length; i++) {
    const dist = Math.abs(values[i] - target);
    if (dist < bestDist) { bestDist = dist; bestIndex = i; }
  }
  return bestIndex;
}

function colorForIndex(index, count) {
  const scaled = (index / Math.max(1, count - 1)) * (DEPTH_COLORS.length - 1);
  return DEPTH_COLORS[Math.round(scaled)];
}

export default function Depth({ depth = -30, depthLevels = null, onDepthChange }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const stateRef = useRef({
    t: 0,
    particles: [],
    bubbles: [],
    fish: [],
  });

  const levels = depthLevels?.length ? depthLevels : FALLBACK_DEPTH_LEVELS;
  const activeIndex = findNearestIndex(levels, depth);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function init() {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      canvas.width = W;
      canvas.height = H;
      const s = stateRef.current;
      s.particles = Array.from({ length: 60 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.5 + Math.random() * 1.5,
        speed: 0.05 + Math.random() * 0.12,
        drift: (Math.random() - 0.5) * 0.04,
        alpha: 0.03 + Math.random() * 0.08,
      }));
      s.bubbles = Array.from({ length: 18 }, () => ({
        x: 10 + Math.random() * (W - 20),
        y: H * 0.3 + Math.random() * H * 0.7,
        r: 1 + Math.random() * 2.5,
        speed: 0.2 + Math.random() * 0.5,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.02 + Math.random() * 0.03,
        alpha: 0.06 + Math.random() * 0.12,
      }));
      s.fish = Array.from({ length: 5 }, () => {
        const df = 0.1 + Math.random() * 0.85;
        return {
          x: Math.random() * W,
          y: df * H,
          speed: (0.2 + Math.random() * 0.4) * (Math.random() < 0.5 ? 1 : -1),
          size: 3 + Math.random() * 5,
          alpha: 0.06 + df * 0.08,
        };
      });
    }

    function draw() {
      const W = canvas.width;
      const H = canvas.height;
      const s = stateRef.current;
      ctx.clearRect(0, 0, W, H);

      const secH = H / levels.length;
      for (let i = 0; i < levels.length; i++) {
        const [r, g, b] = colorForIndex(i, levels.length);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, i * secH, W, secH + 1);
      }

      ctx.fillStyle = 'rgba(125,211,252,0.06)';
      for (let x = 0; x < W; x += 4) {
        const wh = 3 + Math.sin(x * 0.08 + s.t * 0.04) * 2 + Math.sin(x * 0.13 - s.t * 0.025);
        ctx.fillRect(x, 0, 3, wh);
      }

      s.particles.forEach((p) => {
        p.y -= p.speed;
        p.x += p.drift;
        if (p.y < 0) { p.y = H; p.x = Math.random() * W; }
        if (p.x < 0 || p.x > W) p.x = Math.random() * W;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,230,255,${p.alpha})`;
        ctx.fill();
      });

      s.bubbles.forEach((b) => {
        b.y -= b.speed;
        b.wobble += b.wobbleSpeed;
        b.x += Math.sin(b.wobble) * 0.4;
        if (b.y < -5) { b.y = H; b.x = 10 + Math.random() * (W - 20); }
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(180,230,255,${b.alpha})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      });

      s.fish.forEach((f) => {
        f.x += f.speed;
        if (f.x > W + 20) f.x = -20;
        if (f.x < -20) f.x = W + 20;
        const sz = f.size;
        ctx.save();
        ctx.globalAlpha = f.alpha;
        ctx.translate(f.x, f.y);
        if (f.speed < 0) ctx.scale(-1, 1);
        ctx.fillStyle = 'rgba(200,235,255,0.9)';
        ctx.beginPath();
        ctx.ellipse(0, 0, sz, sz * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-sz, 0);
        ctx.lineTo(-sz - sz * 0.7, -sz * 0.4);
        ctx.lineTo(-sz - sz * 0.7, sz * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });

      const selFrac = (activeIndex + 0.5) / levels.length;
      const selY = selFrac * H;
      const grd = ctx.createLinearGradient(0, selY - 30, 0, selY + 30);
      grd.addColorStop(0, 'rgba(125,211,252,0)');
      grd.addColorStop(0.5, 'rgba(125,211,252,0.07)');
      grd.addColorStop(1, 'rgba(125,211,252,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, selY - 30, W, 60);

      s.t++;
      rafRef.current = requestAnimationFrame(draw);
    }

    init();
    draw();
    const ro = new ResizeObserver(init);
    ro.observe(canvas);
    return () => { cancelAnimationFrame(rafRef.current); ro.disconnect(); };
  }, [levels, activeIndex]);

  const handleBodyClick = (e) => {
    if (!onDepthChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientY - rect.top) / rect.height;
    const idx = Math.max(0, Math.min(levels.length - 1, Math.floor(frac * levels.length)));
    onDepthChange(levels[idx]);
  };

  const roundedDepth = Math.round(Math.abs(depth));

  return (
    <div className="currents-depth">
      <div className="currents-depth__header">
        <div className="currents-depth__eyebrow">Select depth</div>
        <div className="currents-depth__value-row">
          <span className="currents-depth__value">
            -{roundedDepth}
            <span className="currents-depth__unit">m</span>
          </span>
          <span className="currents-depth__zone">{DEPTH_ZONES[roundedDepth] ?? ''}</span>
        </div>
      </div>

      <div className="currents-depth__body" onClick={handleBodyClick} style={{ cursor: onDepthChange ? 'pointer' : undefined }}>
        <canvas ref={canvasRef} className="currents-depth__canvas" />

        <div className="currents-depth__track">
          <div
            className="currents-depth__track-fill"
            style={{ height: `${((activeIndex + 0.5) / levels.length) * 100}%` }}
          />
        </div>

        {levels.map((level, index) => {
          const fraction = (index + 0.5) / levels.length;
          const isActive = index === activeIndex;
          return (
            <div
              key={level}
              className="currents-depth__tick"
              style={{ top: `${fraction * 100}%` }}
              onClick={(e) => { e.stopPropagation(); onDepthChange?.(level); }}
            >
              <span className={`currents-depth__tick-line${isActive ? ' currents-depth__tick-line--active' : ''}`} />
              <span className={`currents-depth__tick-label${isActive ? ' currents-depth__tick-label--active' : ''}`}>
                -{Math.abs(Math.round(level))}m
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
