// Animierter Sternenhimmel mit funkelnden Sternen und Sternschnuppen.

export function startStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let stars = [];
  let shooting = [];
  let width = 0;
  let height = 0;
  let dpr = 1;
  let lastFrame = 0;
  let nextShooting = performance.now() + 4000;
  let raf = 0;

  const TINTS = ['255,255,255', '214,224,255', '255,240,214', '200,190,255'];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(700, Math.round((width * height) / 2400));
    stars = Array.from({ length: count }, () => {
      const layer = Math.random() < 0.7 ? 0 : Math.random() < 0.75 ? 1 : 2;
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        r: [0.45, 0.8, 1.25][layer] * (0.7 + Math.random() * 0.6),
        alpha: [0.45, 0.7, 0.95][layer] * (0.6 + Math.random() * 0.4),
        speed: [0.6, 1.4, 2.6][layer],
        twinkle: 0.6 + Math.random() * 2.2,
        phase: Math.random() * Math.PI * 2,
        tint: TINTS[Math.floor(Math.random() * TINTS.length)],
        layer,
      };
    });
    if (reduceMotion.matches) draw(performance.now(), true);
  }

  function spawnShootingStar() {
    const angle = (Math.PI / 180) * (18 + Math.random() * 22);
    shooting.push({
      x: width * (0.2 + Math.random() * 0.8),
      y: height * Math.random() * 0.45,
      vx: -Math.cos(angle) * (520 + Math.random() * 260),
      vy: Math.sin(angle) * (520 + Math.random() * 260),
      life: 0,
      maxLife: 0.9 + Math.random() * 0.5,
    });
  }

  function draw(time, still = false) {
    const dt = lastFrame ? Math.min(0.1, (time - lastFrame) / 1000) : 0;
    lastFrame = time;
    ctx.clearRect(0, 0, width, height);

    for (const s of stars) {
      if (!still) {
        s.x -= s.speed * dt;
        if (s.x < -2) s.x = width + 2;
      }
      const flicker = still ? 1 : 0.65 + 0.35 * Math.sin(time / 1000 * s.twinkle + s.phase);
      ctx.globalAlpha = s.alpha * flicker;
      ctx.fillStyle = `rgb(${s.tint})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.layer === 2) {
        // kleiner Kreuzschimmer bei hellen Sternen
        ctx.globalAlpha = s.alpha * flicker * 0.35;
        ctx.fillRect(s.x - s.r * 3, s.y - 0.25, s.r * 6, 0.5);
        ctx.fillRect(s.x - 0.25, s.y - s.r * 3, 0.5, s.r * 6);
      }
    }

    if (!still) {
      if (time > nextShooting) {
        spawnShootingStar();
        nextShooting = time + 6000 + Math.random() * 9000;
      }
      shooting = shooting.filter((s) => s.life < s.maxLife);
      for (const s of shooting) {
        s.life += dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const fade = 1 - s.life / s.maxLife;
        const tailX = s.x - s.vx * 0.12;
        const tailY = s.y - s.vy * 0.12;
        const gradient = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
        gradient.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
        gradient.addColorStop(1, 'rgba(180,170,255,0)');
        ctx.globalAlpha = 1;
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function loop(time) {
    raf = requestAnimationFrame(loop);
    // ~30 FPS reicht für den Himmel und schont den Akku
    if (time - lastFrame < 32) return;
    draw(time);
  }

  function run() {
    cancelAnimationFrame(raf);
    lastFrame = 0;
    if (reduceMotion.matches || document.hidden) {
      draw(performance.now(), true);
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', run);
  reduceMotion.addEventListener('change', run);
  resize();
  run();
}
