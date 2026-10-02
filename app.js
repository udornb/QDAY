const canvas = document.getElementById("space");
const ctx = canvas.getContext("2d");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resetBtn = document.getElementById("resetBtn");
const speedRange = document.getElementById("speedRange");
const speedValue = document.getElementById("speedValue");
const trailRange = document.getElementById("trailRange");
const trailValue = document.getElementById("trailValue");
const stats = document.getElementById("stats");

const G = 1.0;
const dt = 0.0025;

let running = true;
let trails = [];
let bodies = [];

function makeBody(name, x, y, vx, vy, color) {
  return {
    name,
    mass: 1,
    x, y, vx, vy,
    color
  };
}

function resetSimulation() {
  bodies = [
    makeBody("A", -0.97000436,  0.24308753,  0.4662036850,  0.4323657300, "#ff5d75"),
    makeBody("B",  0.97000436, -0.24308753,  0.4662036850,  0.4323657300, "#5df2a6"),
    makeBody("C",  0.0,         0.0,        -0.93240737,   -0.86473146,   "#55dfff")
  ];

  trails = bodies.map(() => []);
}

function accelerationSnapshot() {
  const a = bodies.map(() => ({ x: 0, y: 0 }));

  for (let i = 0; i < bodies.length; i++) {
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;

      const dx = bodies[j].x - bodies[i].x;
      const dy = bodies[j].y - bodies[i].y;

      const r2 = dx * dx + dy * dy + 1e-12;
      const r = Math.sqrt(r2);
      const invR3 = 1 / (r2 * r);

      const f = G * bodies[j].mass * invR3;

      a[i].x += dx * f;
      a[i].y += dy * f;
    }
  }

  return a;
}

function stepVelocityVerlet() {
  const a0 = accelerationSnapshot();

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    b.x += b.vx * dt + 0.5 * a0[i].x * dt * dt;
    b.y += b.vy * dt + 0.5 * a0[i].y * dt * dt;
  }

  const a1 = accelerationSnapshot();

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    b.vx += 0.5 * (a0[i].x + a1[i].x) * dt;
    b.vy += 0.5 * (a0[i].y + a1[i].y) * dt;
  }
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function worldToScreen(x, y) {
  const rect = canvas.getBoundingClientRect();

  const scale = Math.min(rect.width, rect.height) / 4.8;

  return {
    x: rect.width / 2 + x * scale,
    y: rect.height / 2 - y * scale
  };
}

function drawStars(width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.38)";

  for (let i = 0; i < 130; i++) {
    const x = (i * 67.37) % width;
    const y = (i * 41.83) % height;
    const s = (i % 3 === 0) ? 1.4 : 0.8;
    ctx.fillRect(x, y, s, s);
  }

  ctx.restore();
}

function draw() {
  const rect = canvas.getBoundingClientRect();

  ctx.clearRect(0, 0, rect.width, rect.height);
  drawStars(rect.width, rect.height);

  const trailLength = Number(trailRange.value);

  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];

    trails[i].push({ x: b.x, y: b.y });

    if (trails[i].length > trailLength)
      trails[i].shift();

    if (trails[i].length > 1) {
      ctx.beginPath();

      for (let k = 0; k < trails[i].length; k++) {
        const p = worldToScreen(trails[i][k].x, trails[i][k].y);

        if (k === 0)
          ctx.moveTo(p.x, p.y);
        else
          ctx.lineTo(p.x, p.y);
      }

      ctx.strokeStyle = b.color + "80";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  for (const b of bodies) {
    const p = worldToScreen(b.x, b.y);

    const gradient = ctx.createRadialGradient(
      p.x - 3, p.y - 3, 1,
      p.x, p.y, 15
    );

    gradient.addColorStop(0, "#ffffff");
    gradient.addColorStop(.25, b.color);
    gradient.addColorStop(1, b.color + "00");

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Segoe UI";
    ctx.fillText(b.name, p.x + 12, p.y - 12);
  }

  stats.innerHTML = bodies.map(b =>
    `${b.name}: x=${b.x.toFixed(4)} y=${b.y.toFixed(4)}`
  ).join("<br>");
}

function loop() {
  if (running) {
    const speed = Number(speedRange.value);

    for (let i = 0; i < speed; i++)
      stepVelocityVerlet();
  }

  draw();
  requestAnimationFrame(loop);
}

startBtn.onclick = () => running = true;
pauseBtn.onclick = () => running = false;

resetBtn.onclick = () => {
  resetSimulation();
  running = true;
};

speedRange.oninput = () => {
  speedValue.textContent = speedRange.value + "x";
};

trailRange.oninput = () => {
  trailValue.textContent = trailRange.value;
};

window.addEventListener("resize", resizeCanvas);

resetSimulation();
resizeCanvas();
loop();
