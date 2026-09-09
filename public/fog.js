(() => {
  const canvas = document.getElementById('fog');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0;
  let h = 0;
  let dpr = 1;
  const particles = [];
  const COUNT = reduce ? 18 : 48;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(p, randomY) {
    p.x = Math.random() * (w + 120) - 60;
    p.y = randomY ? Math.random() * h : h + 20 + Math.random() * 40;
    p.r = 18 + Math.random() * 70;
    p.vx = 0.08 + Math.random() * 0.22;
    p.vy = -(0.04 + Math.random() * 0.12);
    p.a = 0.04 + Math.random() * 0.1;
    p.drift = Math.random() * Math.PI * 2;
  }

  function init() {
    particles.length = 0;
    for (let i = 0; i < COUNT; i++) {
      const p = {};
      spawn(p, true);
      particles.push(p);
    }
  }

  let last = 0;
  function frame(t) {
    if (!last) last = t;
    const dt = Math.min(32, t - last) / 16.67;
    last = t;

    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.drift += 0.008 * dt;
      p.x += (p.vx + Math.sin(p.drift) * 0.15) * dt;
      p.y += p.vy * dt;
      if (p.y + p.r < -40 || p.x - p.r > w + 80) spawn(p, false);

      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(255,255,255,${p.a})`);
      g.addColorStop(0.45, `rgba(210,230,245,${p.a * 0.55})`);
      g.addColorStop(1, 'rgba(180,210,235,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }

  resize();
  init();
  window.addEventListener('resize', () => {
    resize();
    init();
  });
  if (!reduce) requestAnimationFrame(frame);
  else {
    // static soft fog wash for reduced motion
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(255,255,255,${p.a})`);
      g.addColorStop(1, 'rgba(180,210,235,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
})();
