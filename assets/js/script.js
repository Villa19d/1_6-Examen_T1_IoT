/* ═══════════════════════════════════════════════════
   BIOSYNC IoT — MAIN SCRIPT
   Author: Luis Rodrigo del Villar Morales
   ═══════════════════════════════════════════════════ */

// ──────────────────────────────────────────────
//  CONFIG
// ──────────────────────────────────────────────
const API_URL = 'https://698605d26964f10bf255430b.mockapi.io/api/v1/dispositivos_IoT';

// ──────────────────────────────────────────────
//  GLOBAL STATE
// ──────────────────────────────────────────────
let editMode = false;
let autoRulesEnabled = true;
let monitorInterval = null;
let refreshRingInterval = null;
let refreshProgress = 0;
let uptimeSeconds = 0;
let alertCount = 0;
let lineChartInstance = null;
let radarChartInstance = null;
let activityChartInstance = null;
let gaugeCtxs = {};
let previousValues = {};          // Para calcular tendencias
let historyLog = [];              // Log de los últimos 10 estados
let activityData = new Array(24).fill(0);  // Actividad por hora (simulado)

// Datos históricos para la línea
const historyPoints = {
    ring: [], step: [], vibe: [], labels: []
};

// ──────────────────────────────────────────────
//  THREE.JS BACKGROUND
// ──────────────────────────────────────────────
function initThreeBackground() {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas || !window.THREE) return;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 5;

    // Partículas
    const count = 600;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const colPalette = [
        [0, 0.96, 0.63],   // green
        [0.31, 0.67, 0.99], // blue
        [1, 0.42, 0.54],    // pink
    ];

    for (let i = 0; i < count; i++) {
        positions[i * 3]     = (Math.random() - 0.5) * 20;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 20;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
        const c = colPalette[Math.floor(Math.random() * colPalette.length)];
        colors[i * 3]     = c[0];
        colors[i * 3 + 1] = c[1];
        colors[i * 3 + 2] = c[2];
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
        size: 0.04, vertexColors: true, transparent: true, opacity: 0.7, sizeAttenuation: true
    });

    const points = new THREE.Points(geo, mat);
    scene.add(points);

    // Líneas de conexión (grid)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00f5a0, transparent: true, opacity: 0.04 });
    const linePts = [];
    for (let i = 0; i < 12; i++) {
        const x = (Math.random() - 0.5) * 16;
        const y = (Math.random() - 0.5) * 16;
        linePts.push(new THREE.Vector3(x, y, -5));
        linePts.push(new THREE.Vector3(x + (Math.random() - 0.5) * 4, y + (Math.random() - 0.5) * 4, -5));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lines);

    let animFrame;
    function animate() {
        animFrame = requestAnimationFrame(animate);
        points.rotation.y += 0.0006;
        points.rotation.x += 0.0002;
        lines.rotation.y += 0.0003;
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// ──────────────────────────────────────────────
//  HELPERS — API
// ──────────────────────────────────────────────
async function fetchDevices() {
    try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return await res.json();
    } catch (e) {
        console.error('fetchDevices:', e);
        return [];
    }
}

async function createDevice(data) {
    data.ultima_lectura = new Date().toLocaleString('es-MX');
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) { console.error('createDevice:', e); return false; }
}

async function updateDevice(id, data) {
    data.ultima_lectura = new Date().toLocaleString('es-MX');
    try {
        const res = await fetch(`${API_URL}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) { console.error('updateDevice:', e); return false; }
}

async function deleteDevice(id) {
    try {
        const res = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
        return res.ok;
    } catch (e) { console.error('deleteDevice:', e); return false; }
}

// ──────────────────────────────────────────────
//  SIMULATION ENGINE
//  Genera valores realistas para cada tipo de sensor
// ──────────────────────────────────────────────
function simulateNextValue(device) {
    const prev = device.valor_sensor ?? 50;
    let next = prev;
    const tipo = device.tipo;

    if (!device.estado) {
        // Dispositivo APAGADO → recuperación lenta o valor estable
        if (tipo === 'plantilla') {
            // Fatiga baja mientras descansa
            next = Math.max(0, prev - (Math.random() * 4 + 1));
        } else if (tipo === 'anillo') {
            // Cortisol baja un poco en reposo
            next = Math.max(10, prev - (Math.random() * 3));
        } else {
            // Pulsera apagada → 0
            next = Math.max(0, prev - (Math.random() * 6 + 2));
        }
        return Math.round(Math.min(100, Math.max(0, next)));
    }

    if (tipo === 'anillo') {
        // Cortisol / GSR: fluctúa con picos de estrés aleatorios
        const stressEvent = Math.random() < 0.15; // 15% prob de evento de estrés
        if (stressEvent) {
            next = Math.min(100, prev + (Math.random() * 20 + 8));
        } else {
            const drift = (Math.random() - 0.4) * 8; // tendencia a bajar levemente
            next = prev + drift;
        }
    } else if (tipo === 'plantilla') {
        // Fatiga acumulativa con picos de actividad
        const activityPeak = Math.random() < 0.2; // 20% pico
        if (activityPeak) {
            next = Math.min(100, prev + (Math.random() * 15 + 5));
        } else {
            next = Math.min(100, prev + (Math.random() * 3 + 0.5));
        }
    } else if (tipo === 'pulsera') {
        // Pulsera háptica: pequeñas variaciones de bienestar
        const drift = (Math.random() - 0.5) * 6;
        next = prev + drift;
        next = Math.max(10, Math.min(80, next)); // Rango normal 10–80
    }

    return Math.round(Math.min(100, Math.max(0, next)));
}

// Aplica simulación a todos los dispositivos activos y los actualiza en la API
async function runSimulation(devices) {
    const updates = [];
    for (const d of devices) {
        const newVal = simulateNextValue(d);
        if (Math.abs(newVal - d.valor_sensor) >= 1) {
            updates.push(updateDevice(d.id, { ...d, valor_sensor: newVal }));
            d.valor_sensor = newVal; // Actualizar en memoria también
        }
    }
    await Promise.all(updates);
    return devices;
}

// ──────────────────────────────────────────────
//  BUSINESS RULES
// ──────────────────────────────────────────────
const shownAlerts = new Set();

async function applyBusinessRules(devices) {
    if (!autoRulesEnabled) return;

    const anillo   = devices.find(d => d.tipo === 'anillo');
    const pulsera  = devices.find(d => d.tipo === 'pulsera');
    const plantilla = devices.find(d => d.tipo === 'plantilla');

    // REGLA 1: Estrés crítico → activar pulsera háptica
    if (anillo && pulsera && anillo.valor_sensor > 80 && !pulsera.estado) {
        await updateDevice(pulsera.id, { ...pulsera, estado: true });
        showModal(
            '⚠️ Estrés Crítico Detectado',
            `El nivel de cortisol de <strong>${anillo.nombre}</strong> ha alcanzado <strong>${anillo.valor_sensor}/100</strong>.<br><br>
            La pulsera háptica <strong>${pulsera.nombre}</strong> se ha activado automáticamente para iniciar el protocolo de regulación térmica y vibración biofeedback.`,
            `Anillo: ${anillo.valor_sensor} | Pulsera: Activada`,
            'warning'
        );
        alertCount++;
        updateHeroAlerts();
    }

    // REGLA 2: Fatiga alta → alerta de descanso
    if (plantilla && plantilla.valor_sensor > 85) {
        const key = `fatigue_${Math.floor(plantilla.valor_sensor / 5)}`;
        if (!shownAlerts.has(key)) {
            shownAlerts.add(key);
            showToast('⚠️ Alta Fatiga', `${plantilla.nombre}: ${plantilla.valor_sensor}/100 — Recomendamos descanso inmediato.`, 'warning');
            alertCount++;
            updateHeroAlerts();
        }
    }

    // REGLA 3: Si pulsera ON y estrés del anillo < 40, apagar pulsera (protocolo completado)
    if (anillo && pulsera && anillo.valor_sensor < 40 && pulsera.estado) {
        await updateDevice(pulsera.id, { ...pulsera, estado: false });
        showToast('✅ Protocolo Completado', `Estrés normalizado (${anillo.valor_sensor}/100). ${pulsera.nombre} desactivada.`, 'success');
    }

    // REGLA 4: Todos los valores normales → badge de bienestar
    if (anillo && plantilla && pulsera &&
        anillo.valor_sensor < 50 && plantilla.valor_sensor < 50) {
        // Toast silencioso ocasional
    }
}

// ──────────────────────────────────────────────
//  GAUGE CANVAS
// ──────────────────────────────────────────────
function drawGauge(canvasId, value, color) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2 + 20;
    const r = Math.min(W, H) / 2 - 16;
    const startAngle = Math.PI * 0.75;
    const endAngle   = Math.PI * 2.25;
    const progress   = value / 100;
    const fillAngle  = startAngle + (endAngle - startAngle) * progress;

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.lineWidth = 12;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Fill
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    if (color === 'ring') { grad.addColorStop(0, '#ff6b8a'); grad.addColorStop(1, '#ff4757'); }
    else if (color === 'step') { grad.addColorStop(0, '#00f5a0'); grad.addColorStop(1, '#00b09b'); }
    else { grad.addColorStop(0, '#4facfe'); grad.addColorStop(1, '#00f2fe'); }

    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, fillAngle);
    ctx.lineWidth = 12;
    ctx.strokeStyle = grad;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Dot at end
    const dotX = cx + r * Math.cos(fillAngle);
    const dotY = cy + r * Math.sin(fillAngle);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 6, 0, Math.PI * 2);
    ctx.fillStyle = 'white';
    ctx.fill();

    // Tick marks
    for (let i = 0; i <= 10; i++) {
        const angle = startAngle + (endAngle - startAngle) * i / 10;
        const inner = r - 16;
        const outer = r - 10;
        ctx.beginPath();
        ctx.moveTo(cx + inner * Math.cos(angle), cy + inner * Math.sin(angle));
        ctx.lineTo(cx + outer * Math.cos(angle), cy + outer * Math.sin(angle));
        ctx.lineWidth = i % 5 === 0 ? 2 : 1;
        ctx.strokeStyle = i * 10 <= value ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.1)';
        ctx.stroke();
    }
}

// ──────────────────────────────────────────────
//  LINE CHART
// ──────────────────────────────────────────────
function initLineChart() {
    const ctx = document.getElementById('lineChart');
    if (!ctx) return;
    if (lineChartInstance) lineChartInstance.destroy();

    lineChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: historyPoints.labels,
            datasets: [
                {
                    label: 'CortiSense', data: historyPoints.ring,
                    borderColor: '#ff6b8a', backgroundColor: 'rgba(255,107,138,0.08)',
                    tension: 0.4, fill: true, pointRadius: 0, borderWidth: 2
                },
                {
                    label: 'StepGuard', data: historyPoints.step,
                    borderColor: '#00f5a0', backgroundColor: 'rgba(0,245,160,0.08)',
                    tension: 0.4, fill: true, pointRadius: 0, borderWidth: 2
                },
                {
                    label: 'ThermoVibe', data: historyPoints.vibe,
                    borderColor: '#4facfe', backgroundColor: 'rgba(79,172,254,0.08)',
                    tension: 0.4, fill: true, pointRadius: 0, borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            animation: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: {
                    min: 0, max: 100,
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: '#4a6275', font: { size: 11 } }
                }
            }
        }
    });
}

function updateLineChart(devices) {
    const ring = devices.find(d => d.tipo === 'anillo');
    const step = devices.find(d => d.tipo === 'plantilla');
    const vibe = devices.find(d => d.tipo === 'pulsera');

    const now = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    historyPoints.labels.push(now);
    historyPoints.ring.push(ring?.valor_sensor ?? 0);
    historyPoints.step.push(step?.valor_sensor ?? 0);
    historyPoints.vibe.push(vibe?.valor_sensor ?? 0);

    // Mantener sólo los últimos 30 puntos
    const MAX = 30;
    if (historyPoints.labels.length > MAX) {
        historyPoints.labels.shift();
        historyPoints.ring.shift();
        historyPoints.step.shift();
        historyPoints.vibe.shift();
    }

    if (lineChartInstance) lineChartInstance.update();
}

// ──────────────────────────────────────────────
//  RADAR CHART (Dashboard)
// ──────────────────────────────────────────────
function initRadarChart() {
    const ctx = document.getElementById('radarChart');
    if (!ctx) return;
    if (radarChartInstance) radarChartInstance.destroy();

    radarChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'radar',
        data: {
            labels: ['Estrés', 'Fatiga', 'Recuperación', 'Actividad', 'Bienestar', 'Temperatura'],
            datasets: [{
                label: 'Biometría Actual',
                data: [0,0,0,0,0,0],
                backgroundColor: 'rgba(0,245,160,0.1)',
                borderColor: '#00f5a0',
                pointBackgroundColor: '#00f5a0',
                pointBorderColor: '#fff',
                pointRadius: 4,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            animation: { duration: 500 },
            plugins: { legend: { display: false } },
            scales: {
                r: {
                    min: 0, max: 100,
                    grid: { color: 'rgba(255,255,255,0.06)' },
                    angleLines: { color: 'rgba(255,255,255,0.06)' },
                    ticks: { display: false },
                    pointLabels: { color: '#8da0b3', font: { size: 11 } }
                }
            }
        }
    });
}

function updateRadarChart(devices) {
    if (!radarChartInstance) return;
    const ring = devices.find(d => d.tipo === 'anillo');
    const step = devices.find(d => d.tipo === 'plantilla');
    const vibe = devices.find(d => d.tipo === 'pulsera');

    const stress     = ring?.valor_sensor ?? 0;
    const fatigue    = step?.valor_sensor ?? 0;
    const haptic     = vibe?.valor_sensor ?? 0;
    const recovery   = Math.max(0, 100 - fatigue);
    const activity   = step?.estado ? Math.min(100, fatigue * 0.8) : 10;
    const wellbeing  = Math.round((recovery + (100 - stress) + (100 - fatigue)) / 3);
    const temp       = Math.round(36 + haptic * 0.03); // Simulado

    radarChartInstance.data.datasets[0].data = [stress, fatigue, recovery, activity, wellbeing, temp < 100 ? temp : 39];
    radarChartInstance.update();
}

// ──────────────────────────────────────────────
//  ACTIVITY CHART
// ──────────────────────────────────────────────
function initActivityChart() {
    const ctx = document.getElementById('activityChart');
    if (!ctx) return;
    if (activityChartInstance) activityChartInstance.destroy();

    // Simular actividad del día
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`);
    const currentHour = new Date().getHours();

    // Simular datos: baja en noche, pico mañana/tarde
    for (let i = 0; i <= currentHour; i++) {
        if (i < 6 || i > 22) activityData[i] = Math.round(Math.random() * 10);
        else if (i >= 6 && i <= 9) activityData[i] = Math.round(40 + Math.random() * 40);
        else if (i >= 12 && i <= 14) activityData[i] = Math.round(50 + Math.random() * 30);
        else activityData[i] = Math.round(20 + Math.random() * 40);
    }

    activityChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: hours,
            datasets: [{
                label: 'Actividad',
                data: activityData,
                backgroundColor: hours.map((_, i) =>
                    i === currentHour ? '#00f5a0' :
                    i < currentHour  ? 'rgba(0,245,160,0.3)' : 'rgba(255,255,255,0.05)'
                ),
                borderRadius: 4,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#4a6275', font: { size: 9 }, maxTicksLimit: 12 }, grid: { display: false } },
                y: { min: 0, max: 100, ticks: { color: '#4a6275', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
        }
    });
}

// ──────────────────────────────────────────────
//  NOTIFICATIONS
// ──────────────────────────────────────────────
let lastModalTime = 0;

function showModal(title, message, deviceInfo = '', type = 'warning') {
    const now = Date.now();
    if (now - lastModalTime < 10000) return; // No spamear modales
    lastModalTime = now;

    document.getElementById('alertModalTitle').textContent = title;
    document.getElementById('alertMessage').innerHTML = message;
    document.getElementById('alertDeviceInfo').textContent = deviceInfo;
    document.getElementById('alertTimestamp').textContent = new Date().toLocaleString('es-MX');

    const header = document.getElementById('alertModalHeader');
    const icon   = document.getElementById('alertIcon');
    if (type === 'warning') {
        header.style.background = 'linear-gradient(135deg, rgba(255,107,138,0.15), rgba(255,71,87,0.1))';
        icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>';
        icon.className = 'alert-icon';
    } else {
        header.style.background = 'linear-gradient(135deg, rgba(79,172,254,0.15), rgba(0,242,254,0.1))';
        icon.innerHTML = '<i class="fa-solid fa-circle-info"></i>';
        icon.className = 'alert-icon info';
    }

    new bootstrap.Modal(document.getElementById('alertModal')).show();
}

const toastQueue = [];
let toastShowing = false;

function showToast(title, body, type = 'info') {
    toastQueue.push({ title, body, type });
    if (!toastShowing) processToastQueue();
}

function processToastQueue() {
    if (!toastQueue.length) { toastShowing = false; return; }
    toastShowing = true;
    const { title, body, type } = toastQueue.shift();

    document.getElementById('toastTitle').textContent = title;
    document.getElementById('toastBody').textContent = body;
    document.getElementById('toastTime').textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

    const dot = document.getElementById('toastDot');
    dot.style.background = type === 'warning' ? '#fbbf24' : type === 'success' ? '#00f5a0' : '#4facfe';

    const toastEl = document.getElementById('liveToast');
    const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
    toastEl.addEventListener('hidden.bs.toast', () => {
        setTimeout(processToastQueue, 300);
    }, { once: true });
    toast.show();
}

// ──────────────────────────────────────────────
//  RENDER — ADMIN TABLE (sin parpadeo)
// ──────────────────────────────────────────────

// Guarda los IDs que ya están renderizados en la tabla
let adminTableRenderedIds = [];

// Entrada pública: fetch + decide si construir o solo parchear
async function renderAdminTable() {
    const devices = await fetchDevices();
    const newIds = devices.map(d => String(d.id));
    const sameStructure =
        newIds.length === adminTableRenderedIds.length &&
        newIds.every((id, i) => id === adminTableRenderedIds[i]);

    if (sameStructure && adminTableRenderedIds.length > 0) {
        _patchAdminTable(devices);
    } else {
        _buildAdminTable(devices);
    }
}

// Construye la tabla completa (solo cuando la lista de dispositivos cambia)
function _buildAdminTable(devices) {
    const tbody = document.getElementById('deviceTableBody');
    if (!tbody) return;

    const count = document.getElementById('deviceCount');
    if (count) count.textContent = `${devices.length} dispositivo${devices.length !== 1 ? 's' : ''}`;

    if (!devices.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5 text-muted"><i class="fa-solid fa-box-open me-2"></i>No hay dispositivos. ¡Crea uno arriba!</td></tr>';
        adminTableRenderedIds = [];
        return;
    }

    tbody.innerHTML = '';
    adminTableRenderedIds = [];

    devices.forEach(d => {
        const typeLabel = d.tipo === 'anillo' ? '🔴 Anillo' : d.tipo === 'plantilla' ? '🟢 Plantilla' : '🔵 Pulsera';
        const barColor  = d.tipo === 'anillo' ? '#ff6b8a' : d.tipo === 'plantilla' ? '#00f5a0' : '#4facfe';
        const pct = d.valor_sensor ?? 0;

        const tr = document.createElement('tr');
        tr.setAttribute('data-device-id', d.id);
        tr.innerHTML = `
            <td class="text-muted" style="font-size:11px;font-family:var(--font-display)">#${d.id}</td>
            <td style="font-family:var(--font-display);font-weight:700">${d.nombre}</td>
            <td><span class="type-badge ${d.tipo}">${typeLabel}</span></td>
            <td>
                <div class="sensor-bar-wrap">
                    <strong class="cell-valor" style="font-variant-numeric:tabular-nums;min-width:28px;display:inline-block">${pct}</strong>
                    <div class="sensor-bar-bg" style="flex:1">
                        <div class="cell-bar sensor-bar-fill" style="width:${pct}%;background:${barColor}"></div>
                    </div>
                </div>
            </td>
            <td><span class="cell-estado status-pill ${d.estado ? 'on' : 'off'}">
                ${d.estado ? '<i class="fa-solid fa-circle-dot"></i> Encendido' : '<i class="fa-regular fa-circle"></i> Apagado'}
            </span></td>
            <td class="cell-lectura" style="font-size:12px;color:var(--text-muted)">${d.ultima_lectura || '—'}</td>
            <td>
                <div class="d-flex gap-1">
                    <button class="btn-icon edit" data-id="${d.id}" title="Editar"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-icon del" data-id="${d.id}" title="Eliminar"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
        adminTableRenderedIds.push(String(d.id));
    });

    tbody.querySelectorAll('.edit').forEach(btn =>
        btn.addEventListener('click', e => editDevice(e.currentTarget.dataset.id)));
    tbody.querySelectorAll('.del').forEach(btn =>
        btn.addEventListener('click', e => {
            if (confirm('¿Eliminar este dispositivo?')) handleDelete(e.currentTarget.dataset.id);
        }));
}

// Solo actualiza los valores dinámicos sin reconstruir el DOM
function _patchAdminTable(devices) {
    const tbody = document.getElementById('deviceTableBody');
    if (!tbody) return;

    devices.forEach(d => {
        const tr = tbody.querySelector(`tr[data-device-id="${d.id}"]`);
        if (!tr) return;

        const pct      = d.valor_sensor ?? 0;
        const barColor = d.tipo === 'anillo' ? '#ff6b8a' : d.tipo === 'plantilla' ? '#00f5a0' : '#4facfe';

        const valorEl   = tr.querySelector('.cell-valor');
        const barEl     = tr.querySelector('.cell-bar');
        const estadoEl  = tr.querySelector('.cell-estado');
        const lecturaEl = tr.querySelector('.cell-lectura');

        if (valorEl && valorEl.textContent !== String(pct)) {
            valorEl.textContent = pct;
        }
        if (barEl) {
            barEl.style.width      = `${pct}%`;
            barEl.style.background = barColor;
        }
        if (estadoEl) {
            const isOn  = !!d.estado;
            const wasOn = estadoEl.classList.contains('on');
            if (isOn !== wasOn) {
                estadoEl.className = `cell-estado status-pill ${isOn ? 'on' : 'off'}`;
                estadoEl.innerHTML = isOn
                    ? '<i class="fa-solid fa-circle-dot"></i> Encendido'
                    : '<i class="fa-regular fa-circle"></i> Apagado';
            }
        }
        if (lecturaEl && d.ultima_lectura) {
            lecturaEl.textContent = d.ultima_lectura;
        }
    });

    const count = document.getElementById('deviceCount');
    if (count) count.textContent = `${devices.length} dispositivo${devices.length !== 1 ? 's' : ''}`;
}

// ──────────────────────────────────────────────
//  RENDER — CONTROL CARDS
// ──────────────────────────────────────────────
async function renderControlCards() {
    const container = document.getElementById('controlCards');
    if (!container) return;

    const devices = await fetchDevices();
    if (!devices.length) {
        container.innerHTML = '<div class="col-12 text-center py-5 text-muted">No hay dispositivos registrados.</div>';
        return;
    }

    container.innerHTML = '';
    devices.forEach(d => {
        const typeLabel = d.tipo === 'anillo' ? 'Anillo Sensor' : d.tipo === 'plantilla' ? 'Plantilla Inteligente' : 'Pulsera Háptica';
        const typeDesc  = d.tipo === 'anillo' ? 'CortiSense — GSR / Cortisol' : d.tipo === 'plantilla' ? 'StepGuard — Fatiga Plantar' : 'ThermoVibe — Háptica Térmica';
        const barColor  = d.tipo === 'anillo' ? '#ff6b8a' : d.tipo === 'plantilla' ? '#00f5a0' : '#4facfe';
        const iconClass = d.tipo === 'anillo' ? 'ring-gradient' : d.tipo === 'plantilla' ? 'step-gradient' : 'vibe-gradient';
        const iconName  = d.tipo === 'anillo' ? 'ring' : d.tipo === 'plantilla' ? 'shoe-prints' : 'wave-square';
        const pct = d.valor_sensor ?? 0;

        const interpLevel = pct < 40 ? 'low' : pct < 70 ? 'medium' : 'high';
        const interpText  = pct < 40 ? 'Nivel Normal' : pct < 70 ? 'Moderado' : 'Crítico';

        // Programas según tipo
        const programs = d.tipo === 'anillo'
            ? ['Respiración', 'Meditación', 'Focus']
            : d.tipo === 'plantilla'
            ? ['Caminar', 'Correr', 'Reposo']
            : ['Suave', 'Medio', 'Intenso'];

        const col = document.createElement('div');
        col.className = 'col-md-4';
        col.innerHTML = `
            <div class="control-card">
                <div class="control-card-header">
                    <div class="control-device-icon ${iconClass}">
                        <i class="fa-solid fa-${iconName}"></i>
                    </div>
                    <div>
                        <div class="control-device-name">${d.nombre}</div>
                        <div class="control-device-type">${typeLabel} · ${typeDesc}</div>
                    </div>
                </div>
                <div class="control-card-body">
                    <div class="control-metric">
                        <span class="control-metric-label">Valor Sensor</span>
                        <span class="control-metric-value" style="color:${barColor}">${pct}<small style="font-size:13px;font-weight:400;color:var(--text-muted)">/100</small></span>
                    </div>
                    <div class="control-full-bar">
                        <div class="control-full-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${barColor},${barColor}aa)"></div>
                    </div>
                    <span class="interp-chip ${interpLevel}">
                        <i class="fa-solid fa-circle-dot"></i> ${interpText}
                    </span>

                    <hr class="control-divider">

                    <div class="control-toggle-wrap">
                        <span class="control-toggle-label">
                            ${d.estado ? '<i class="fa-solid fa-power-off me-1" style="color:var(--accent-green)"></i> Encendido' : '<i class="fa-regular fa-circle me-1"></i> Apagado'}
                        </span>
                        <label class="switch">
                            <input type="checkbox" class="toggle-switch" data-id="${d.id}" ${d.estado ? 'checked' : ''}>
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div style="margin-top:14px">
                        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--text-muted);margin-bottom:6px">Modo de operación</div>
                        <div class="program-btns">
                            ${programs.map((p, i) => `<button class="program-btn${i === 0 ? ' active' : ''}" data-id="${d.id}" data-prog="${p}">${p}</button>`).join('')}
                        </div>
                    </div>

                    <div style="margin-top:14px;font-size:11px;color:var(--text-muted)">
                        <i class="fa-solid fa-clock me-1"></i> Última lectura: ${d.ultima_lectura || '—'}
                    </div>
                </div>
            </div>
        `;
        container.appendChild(col);
    });

    // Toggle switches
    container.querySelectorAll('.toggle-switch').forEach(toggle => {
        toggle.addEventListener('change', async e => {
            const id = e.target.dataset.id;
            const newState = e.target.checked;
            const devs = await fetchDevices();
            const device = devs.find(d => d.id === id);
            if (device) {
                await updateDevice(id, { ...device, estado: newState });
                showToast(
                    newState ? '✅ Dispositivo Encendido' : '⭕ Dispositivo Apagado',
                    `${device.nombre} ahora está ${newState ? 'activo' : 'inactivo'}.`,
                    newState ? 'success' : 'info'
                );
                renderControlCards();
                renderAdminTable();
            }
        });
    });

    // Program buttons
    container.querySelectorAll('.program-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            const id = e.currentTarget.dataset.id;
            const prog = e.currentTarget.dataset.prog;
            // Quitar activo de sus hermanos
            container.querySelectorAll(`.program-btn[data-id="${id}"]`).forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            showToast('⚙️ Modo actualizado', `Modo "${prog}" seleccionado.`, 'info');
        });
    });
}

// ──────────────────────────────────────────────
//  RENDER — MONITOR
// ──────────────────────────────────────────────
async function renderMonitor() {
    const devices = await fetchDevices();

    // Simulación de valores
    const updated = await runSimulation(devices);

    // Gauges
    const ring = updated.find(d => d.tipo === 'anillo');
    const step = updated.find(d => d.tipo === 'plantilla');
    const vibe = updated.find(d => d.tipo === 'pulsera');

    updateGaugeUI('Ring',  ring,  'gaugeRing',  'ring',  'gaugeRingVal',  'ringStatus',  'ringTrend',  '#ff6b8a');
    updateGaugeUI('Step',  step,  'gaugeStep',  'step',  'gaugeStepVal',  'stepStatus',  'stepTrend',  '#00f5a0');
    updateGaugeUI('Vibe',  vibe,  'gaugeVibe',  'vibe',  'gaugeVibeVal',  'vibeStatus',  'vibeTrend',  '#4facfe');

    // Hero values
    setTextSafe('heroRingVal', ring ? ring.valor_sensor : '--');
    setTextSafe('heroStepVal', step ? step.valor_sensor : '--');
    setTextSafe('heroVibeVal', vibe ? vibe.valor_sensor : '--');

    // Line chart
    updateLineChart(updated);

    // History table
    updateHistoryTable(updated);

    // Dashboard
    updateDashboard(updated);

    // Business Rules
    await applyBusinessRules(updated);

    // Actualizar tabla admin con los datos ya cargados (sin nuevo fetch, sin parpadeo)
    smartUpdateAdminTable(updated);
}

// Wrapper público para llamar desde _buildAdminTable y desde el monitor con datos ya disponibles
function smartUpdateAdminTable(devices) {
    const newIds = devices.map(d => String(d.id));
    const sameStructure =
        newIds.length === adminTableRenderedIds.length &&
        newIds.every((id, i) => id === adminTableRenderedIds[i]);

    if (sameStructure && adminTableRenderedIds.length > 0) {
        _patchAdminTable(devices);
    } else {
        _buildAdminTable(devices);
    }
}

function updateGaugeUI(key, device, canvasId, colorKey, valId, statusId, trendId, color) {
    if (!device) return;
    const val = device.valor_sensor ?? 0;
    drawGauge(canvasId, val, colorKey);
    setTextSafe(valId, val);

    const statusEl = document.getElementById(statusId);
    if (statusEl) {
        statusEl.textContent = device.estado ? 'Activo' : 'Inactivo';
        statusEl.style.background = device.estado ? 'rgba(0,245,160,0.15)' : 'rgba(74,98,117,0.2)';
        statusEl.style.color = device.estado ? '#00f5a0' : '#4a6275';
    }

    const prev = previousValues[key];
    const trend = prev !== undefined ? val - prev : 0;
    const trendEl = document.getElementById(trendId);
    if (trendEl) {
        if (trend > 0) {
            trendEl.innerHTML = `<span style="color:#ff6b8a">▲ +${trend.toFixed(0)}</span> subiendo`;
        } else if (trend < 0) {
            trendEl.innerHTML = `<span style="color:#00f5a0">▼ ${trend.toFixed(0)}</span> bajando`;
        } else {
            trendEl.innerHTML = `<span style="color:#4a6275">→</span> estable`;
        }
    }
    previousValues[key] = val;
}

function updateHistoryTable(devices) {
    const now = new Date();
    devices.forEach(d => {
        historyLog.unshift({
            nombre: d.nombre,
            valor: d.valor_sensor,
            estado: d.estado ? 'Encendido' : 'Apagado',
            tipo: d.tipo,
            hora: now.toLocaleTimeString('es-MX')
        });
    });
    if (historyLog.length > 10) historyLog = historyLog.slice(0, 10);

    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    historyLog.forEach(item => {
        const pct = item.valor;
        const level = pct < 40 ? 'normal' : pct < 70 ? 'warning' : 'critical';
        const interp = pct < 40 ? 'Normal' : pct < 70 ? 'Moderado' : 'Crítico';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family:var(--font-display);font-weight:700">${item.nombre}</td>
            <td style="font-variant-numeric:tabular-nums;font-weight:700">${pct}</td>
            <td><span class="status-pill ${item.estado === 'Encendido' ? 'on' : 'off'}">${item.estado}</span></td>
            <td><span class="interp-tag ${level}">${interp}</span></td>
            <td style="font-size:11px;color:var(--text-muted)">${item.hora}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ──────────────────────────────────────────────
//  DASHBOARD
// ──────────────────────────────────────────────
function updateDashboard(devices) {
    const ring = devices.find(d => d.tipo === 'anillo');
    const step = devices.find(d => d.tipo === 'plantilla');
    const vibe = devices.find(d => d.tipo === 'pulsera');

    const stress  = ring?.valor_sensor ?? 0;
    const fatigue = step?.valor_sensor ?? 0;
    const haptic  = vibe?.valor_sensor ?? 0;
    const wellbeing = Math.round((100 - stress + 100 - fatigue + haptic / 2) / 2.5);

    setTextSafe('kpiStress',  stress);
    setTextSafe('kpiFatigue', fatigue);
    setTextSafe('kpiHaptic',  haptic);
    setTextSafe('kpiHealth',  Math.max(0, Math.min(100, wellbeing)));

    setBarWidth('kpiStressBar',  stress);
    setBarWidth('kpiFatigueBar', fatigue);
    setBarWidth('kpiHapticBar',  haptic);
    setBarWidth('kpiHealthBar',  Math.max(0, Math.min(100, wellbeing)));

    updateHeroStats(devices);
    updateRadarChart(devices);
    generateRecommendations(stress, fatigue, haptic);
}

function generateRecommendations(stress, fatigue, haptic) {
    const body = document.getElementById('recommendationsBody');
    if (!body) return;

    const recs = [];

    if (stress > 75)
        recs.push({ icon: 'fa-brain', color: 'var(--accent-pink)',   text: `Nivel de estrés elevado (${stress}/100). Se recomienda una sesión de respiración diafragmática de 5 minutos. La pulsera ThermoVibe puede activarse en modo "Suave" para asistir.` });
    else if (stress > 50)
        recs.push({ icon: 'fa-brain', color: '#fbbf24', text: `Estrés moderado (${stress}/100). Considera hacer una pausa de 5 minutos cada hora para mantener la productividad óptima.` });
    else
        recs.push({ icon: 'fa-brain', color: 'var(--accent-green)', text: `Niveles de estrés dentro del rango óptimo (${stress}/100). ¡Excelente! Continúa con tus actividades actuales.` });

    if (fatigue > 80)
        recs.push({ icon: 'fa-person-running', color: 'var(--accent-pink)', text: `Fatiga muscular alta (${fatigue}/100). Se recomienda descanso inmediato y elevación de extremidades por al menos 20 minutos.` });
    else if (fatigue > 55)
        recs.push({ icon: 'fa-person-running', color: '#fbbf24', text: `Fatiga moderada (${fatigue}/100). Reduce la intensidad de la actividad actual. Considera estiramientos.` });
    else
        recs.push({ icon: 'fa-person-running', color: 'var(--accent-green)', text: `Fatiga muscular en rango normal (${fatigue}/100). Tu cuerpo está respondiendo bien al nivel de actividad.` });

    if (haptic > 60)
        recs.push({ icon: 'fa-wave-square', color: 'var(--accent-blue)', text: `ThermoVibe operando a alta intensidad (${haptic}/100). Modo de regulación térmica activo para contrarrestar el estrés detectado.` });
    else
        recs.push({ icon: 'fa-wave-square', color: 'var(--text-secondary)', text: `ThermoVibe en modo standby (${haptic}/100). Listo para activar protocolo de bienestar cuando sea necesario.` });

    body.innerHTML = recs.map(r => `
        <div class="rec-item">
            <i class="fa-solid ${r.icon}" style="color:${r.color};margin-top:2px"></i>
            <span>${r.text}</span>
        </div>
    `).join('');
}

// ──────────────────────────────────────────────
//  CRUD HELPERS
// ──────────────────────────────────────────────
async function editDevice(id) {
    const devices = await fetchDevices();
    const d = devices.find(d => d.id == id);
    if (!d) return;

    document.getElementById('deviceId').value = d.id;
    document.getElementById('nombre').value = d.nombre;
    document.getElementById('tipo').value = d.tipo;
    document.getElementById('valor_sensor').value = d.valor_sensor;
    document.getElementById('formSubmitBtn').innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i> Actualizar';
    document.getElementById('formTitle').innerHTML = '<i class="fa-solid fa-pen-to-square me-2"></i>Editando Dispositivo';
    editMode = true;
    document.getElementById('deviceForm').closest('.form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handleDelete(id) {
    const ok = await deleteDevice(id);
    if (ok) {
        showToast('🗑️ Eliminado', 'Dispositivo eliminado correctamente.', 'info');
        renderAdminTable();
        renderControlCards();
    }
}

function resetForm() {
    document.getElementById('deviceForm').reset();
    document.getElementById('deviceId').value = '';
    document.getElementById('formSubmitBtn').innerHTML = '<i class="fa-solid fa-floppy-disk me-1"></i> Guardar';
    document.getElementById('formTitle').innerHTML = '<i class="fa-solid fa-plus-circle me-2"></i>Nuevo Dispositivo';
    editMode = false;
}

// ──────────────────────────────────────────────
//  UI HELPERS
// ──────────────────────────────────────────────
function setTextSafe(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setBarWidth(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
}

function updateHeroStats(devices) {
    setTextSafe('heroDevices', devices.length);
    setTextSafe('heroOnline', devices.filter(d => d.estado).length);
}

function updateHeroAlerts() {
    setTextSafe('heroAlerts', alertCount);
}

function scrollToApp() {
    document.getElementById('appSection').scrollIntoView({ behavior: 'smooth' });
}
window.scrollToApp = scrollToApp;

function switchTab(name) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.app-tab-btn').forEach(b => b.classList.remove('active'));
    const panel = document.getElementById(`tab-${name}`);
    if (panel) panel.classList.add('active');
    const btn = document.querySelector(`.app-tab-btn[data-target="${name}"]`);
    if (btn) btn.classList.add('active');
    document.getElementById('appSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.switchTab = switchTab;

// Refresh countdown ring animation
function startRefreshRing() {
    const ring = document.getElementById('refreshRing');
    const countdown = document.getElementById('refreshCountdown');
    const total = 94.2; // 2 * pi * 15
    let elapsed = 0;
    const step = 100; // ms

    if (refreshRingInterval) clearInterval(refreshRingInterval);
    refreshRingInterval = setInterval(() => {
        elapsed += step;
        const progress = (elapsed % 2000) / 2000;
        const offset = total - (total * progress);
        if (ring) ring.setAttribute('stroke-dashoffset', offset);
        const remaining = Math.ceil((2000 - (elapsed % 2000)) / 1000);
        if (countdown) countdown.textContent = `${remaining}s`;
    }, step);
}

// Uptime counter
function startUptime() {
    const start = Date.now();
    setInterval(() => {
        const elapsed = Math.floor((Date.now() - start) / 1000);
        const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
        const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        const el = document.getElementById('uptimeDisplay');
        if (el) el.textContent = `${h}:${m}:${s}`;
    }, 1000);
}

// Clock
function startClock() {
    const el = document.getElementById('navTime');
    setInterval(() => {
        if (el) el.textContent = new Date().toLocaleTimeString('es-MX');
    }, 1000);
}

// Navbar scroll effect
window.addEventListener('scroll', () => {
    const nav = document.getElementById('mainNavbar');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 60);
});

// ──────────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Three.js
    initThreeBackground();

    // Clock & uptime
    startClock();
    startUptime();

    // Tab navigation
    document.querySelectorAll('.app-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.app-tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
            btn.classList.add('active');
            const target = document.getElementById(`tab-${btn.dataset.target}`);
            if (target) target.classList.add('active');
        });
    });

    // Navbar links
    document.querySelectorAll('.nav-pill[data-tab]').forEach(link => {
        link.addEventListener('click', e => {
            e.preventDefault();
            document.querySelectorAll('.nav-pill').forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            switchTab(link.dataset.tab);
        });
    });

    // Form submit
    document.getElementById('deviceForm').addEventListener('submit', async e => {
        e.preventDefault();
        const id = document.getElementById('deviceId').value;
        const data = {
            nombre:       document.getElementById('nombre').value,
            tipo:         document.getElementById('tipo').value,
            valor_sensor: parseInt(document.getElementById('valor_sensor').value),
            estado:       false,
        };

        let ok = false;
        if (editMode && id) {
            const devs = await fetchDevices();
            const old = devs.find(d => d.id == id);
            data.estado = old?.estado ?? false;
            ok = await updateDevice(id, data);
        } else {
            ok = await createDevice(data);
        }

        if (ok) {
            showToast(editMode ? '✏️ Actualizado' : '✅ Creado', `Dispositivo "${data.nombre}" guardado.`, 'success');
            resetForm();
            renderAdminTable();
            renderControlCards();
        } else {
            alert('Error al guardar. Verifica la conexión con la API.');
        }
    });

    document.getElementById('cancelEdit').addEventListener('click', resetForm);

    // Auto rules toggle
    const toggleRules = document.getElementById('toggleAutoRules');
    if (toggleRules) {
        toggleRules.addEventListener('click', () => {
            autoRulesEnabled = !autoRulesEnabled;
            toggleRules.innerHTML = autoRulesEnabled
                ? '<i class="fa-solid fa-power-off me-1"></i> Desactivar auto-reglas'
                : '<i class="fa-solid fa-power-off me-1"></i> Activar auto-reglas';
            showToast(
                autoRulesEnabled ? '🤖 Auto-reglas ON' : '🤖 Auto-reglas OFF',
                autoRulesEnabled ? 'Automatización de dispositivos activada.' : 'La IA no tomará acciones automáticas.',
                autoRulesEnabled ? 'success' : 'info'
            );
        });
    }

    // Init charts
    initLineChart();
    initRadarChart();
    initActivityChart();

    // Initial render
    await renderAdminTable();
    await renderControlCards();
    await renderMonitor();

    // Start monitoring interval (2s)
    if (monitorInterval) clearInterval(monitorInterval);
    monitorInterval = setInterval(renderMonitor, 2000);

    // Refresh ring animation
    startRefreshRing();

    window.addEventListener('beforeunload', () => {
        clearInterval(monitorInterval);
        clearInterval(refreshRingInterval);
    });
});