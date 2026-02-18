// ---------- CONFIGURACIÓN ----------
const API_URL = 'https://698605d26964f10bf255430b.mockapi.io/api/v1/dispositivos_IoT'; 

// Variables globales
let editMode = false;
let chartInstance = null;
let monitorInterval = null;

// ---------- FUNCIONES AUXILIARES (Fetch) ----------
async function fetchDevices() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error('Error al cargar');
        return await response.json();
    } catch (error) {
        console.error('Fetch error:', error);
        return [];
    }
}

async function createDevice(device) {
    device.ultima_lectura = new Date().toLocaleString(); // Añadir fecha actual
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(device)
        });
        return response.ok;
    } catch (error) {
        console.error('Create error:', error);
        return false;
    }
}

async function updateDevice(id, device) {
    device.ultima_lectura = new Date().toLocaleString(); // Actualizar fecha
    try {
        const response = await fetch(`${API_URL}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(device)
        });
        return response.ok;
    } catch (error) {
        console.error('Update error:', error);
        return false;
    }
}

async function deleteDevice(id) {
    try {
        const response = await fetch(`${API_URL}/${id}`, { method: 'DELETE' });
        return response.ok;
    } catch (error) {
        console.error('Delete error:', error);
        return false;
    }
}

// ---------- REGLAS DE NEGOCIO "INTELIGENTES" ----------
function aplicarReglasNegocio(dispositivos) {
    const anillo = dispositivos.find(d => d.tipo === 'anillo');
    const pulsera = dispositivos.find(d => d.tipo === 'pulsera');
    const plantilla = dispositivos.find(d => d.tipo === 'plantilla');

    // Regla 1: Si el estrés (anillo) es > 80, encender la pulsera
    if (anillo && pulsera && anillo.valor_sensor > 80 && pulsera.estado === false) {
        console.log('REGLAS: Estrés alto, activando pulsera.');
        updateDevice(pulsera.id, { ...pulsera, estado: true });
        // Mostrar alerta
        document.getElementById('alertMessage').innerText = '🧠 Alerta: Nivel de estrés crítico. La pulsera háptica se ha activado para regular la temperatura.';
        new bootstrap.Modal(document.getElementById('alertModal')).show();
    }

    // Regla 2: Si la fatiga (plantilla) es > 85, mostrar alerta visual
    if (plantilla && plantilla.valor_sensor > 85) {
        document.getElementById('alertMessage').innerText = '🦶 Recomendación: Alta fatiga muscular detectada. Tome un descanso.';
        new bootstrap.Modal(document.getElementById('alertModal')).show();
    }
}

// ---------- RENDERIZAR TABLA DE ADMINISTRACIÓN (CRUD) ----------
async function renderAdminTable() {
    const tbody = document.getElementById('deviceTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Cargando...</td></tr>';
    const devices = await fetchDevices();

    if (devices.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No hay dispositivos. ¡Crea uno!</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    devices.forEach(device => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${device.id}</td>
            <td>${device.nombre}</td>
            <td>${device.tipo}</td>
            <td>${device.valor_sensor}</td>
            <td>${device.estado ? '✅ Encendido' : '⭕ Apagado'}</td>
            <td>${device.ultima_lectura || 'N/A'}</td>
            <td>
                <button class="btn btn-sm btn-warning edit-btn" data-id="${device.id}"><i class="fa-solid fa-pen-to-square"></i></button>
                <button class="btn btn-sm btn-danger delete-btn" data-id="${device.id}"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
    });

    // Añadir eventos a los botones de editar y eliminar
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            editDevice(id);
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (confirm('¿Seguro que quieres eliminar este dispositivo?')) {
                const id = e.currentTarget.dataset.id;
                handleDelete(id);
            }
        });
    });
}

// ---------- RENDERIZAR TARJETAS DE CONTROL ----------
async function renderControlCards() {
    const container = document.getElementById('controlCards');
    container.innerHTML = '<div class="col-12 text-center">Cargando...</div>';
    const devices = await fetchDevices();

    if (devices.length === 0) {
        container.innerHTML = '<div class="col-12 text-center">No hay dispositivos.</div>';
        return;
    }

    container.innerHTML = '';
    devices.forEach(device => {
        const card = document.createElement('div');
        card.className = 'col-md-4 mb-3';
        card.innerHTML = `
            <div class="card">
                <div class="card-body">
                    <h5 class="card-title">${device.nombre}</h5>
                    <p class="card-text">Tipo: ${device.tipo}</p>
                    <p class="card-text">Último valor: <strong>${device.valor_sensor}</strong></p>
                    <p class="card-text">Estado: <span class="badge ${device.estado ? 'bg-success' : 'bg-secondary'}">${device.estado ? 'Encendido' : 'Apagado'}</span></p>
                    <div class="form-check form-switch">
                        <input class="form-check-input toggle-switch" type="checkbox" data-id="${device.id}" ${device.estado ? 'checked' : ''}>
                        <label class="form-check-label">Encender/Apagar</label>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);
    });

    // Eventos para los interruptores (toggles)
    document.querySelectorAll('.toggle-switch').forEach(toggle => {
        toggle.addEventListener('change', async (e) => {
            const id = e.target.dataset.id;
            const newState = e.target.checked;
            // Buscar el dispositivo para mantener sus otros datos
            const devices = await fetchDevices();
            const device = devices.find(d => d.id === id);
            if (device) {
                device.estado = newState;
                await updateDevice(id, device);
                renderControlCards(); // Re-renderizar para actualizar la badge de estado
                renderAdminTable(); // Actualizar también la tabla de admin
                // El monitoreo se actualiza solo con su intervalo
            }
        });
    });
}

// ---------- FUNCIONES PARA MONITOREO (Gráfica y Tabla) ----------
async function renderMonitor() {
    const devices = await fetchDevices();

    // 1. Actualizar tabla de últimos 10 estados
    const historyTbody = document.getElementById('historyTableBody');
    // Crear un array plano de "eventos" para la tabla
    let history = [];
    devices.forEach(d => {
        history.push({
            nombre: d.nombre,
            valor: d.valor_sensor,
            estado: d.estado ? 'Encendido' : 'Apagado',
            hora: d.ultima_lectura || 'N/A'
        });
    });
    // Ordenar por hora (si existe) y tomar los últimos 10
    history.sort((a, b) => (b.hora > a.hora) ? 1 : -1);
    const last10 = history.slice(0, 10);

    if (last10.length === 0) {
        historyTbody.innerHTML = '<tr><td colspan="4" class="text-center">Sin datos</td></tr>';
    } else {
        historyTbody.innerHTML = '';
        last10.forEach(item => {
            const row = historyTbody.insertRow();
            row.innerHTML = `<td>${item.nombre}</td><td>${item.valor}</td><td>${item.estado}</td><td>${item.hora}</td>`;
        });
    }

    // 2. Actualizar gráfica
    const ctx = document.getElementById('sensorChart').getContext('2d');
    const nombres = devices.map(d => d.nombre);
    const valores = devices.map(d => d.valor_sensor);

    if (chartInstance) {
        chartInstance.destroy(); // Destruir gráfica anterior para actualizar
    }

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: nombres,
            datasets: [{
                label: 'Valor del Sensor (0-100)',
                data: valores,
                backgroundColor: ['#ff6384', '#36a2eb', '#ffce56'],
                borderWidth: 1
            }]
        },
        options: {
            scales: { y: { beginAtZero: true, max: 100 } }
        }
    });

    // 3. Aplicar reglas de negocio cada vez que se monitorea
    aplicarReglasNegocio(devices);
}

// ---------- FUNCIONES PARA CRUD (Editar, Eliminar, Guardar) ----------
async function editDevice(id) {
    const devices = await fetchDevices();
    const device = devices.find(d => d.id == id);
    if (device) {
        document.getElementById('deviceId').value = device.id;
        document.getElementById('nombre').value = device.nombre;
        document.getElementById('tipo').value = device.tipo;
        document.getElementById('valor_sensor').value = device.valor_sensor;
        document.getElementById('formSubmitBtn').textContent = 'Actualizar';
        editMode = true;
        // Hacer scroll al formulario
        document.getElementById('deviceForm').scrollIntoView({ behavior: 'smooth' });
    }
}

async function handleDelete(id) {
    await deleteDevice(id);
    renderAdminTable();
    renderControlCards();
    renderMonitor(); // Actualizar monitoreo
}

// Resetear formulario
function resetForm() {
    document.getElementById('deviceForm').reset();
    document.getElementById('deviceId').value = '';
    document.getElementById('formSubmitBtn').textContent = 'Guardar';
    editMode = false;
}

// ---------- EVENT LISTENERS (Escuchadores) ----------
document.addEventListener('DOMContentLoaded', () => {
    // Renderizar todo al cargar la página
    renderAdminTable();
    renderControlCards();
    renderMonitor();

    // Configurar el intervalo de monitoreo (CADA 2 SEGUNDOS)
    if (monitorInterval) clearInterval(monitorInterval);
    monitorInterval = setInterval(renderMonitor, 2000);

    // Evento para el formulario de administración (Crear/Actualizar)
    document.getElementById('deviceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('deviceId').value;
        const deviceData = {
            nombre: document.getElementById('nombre').value,
            tipo: document.getElementById('tipo').value,
            valor_sensor: parseInt(document.getElementById('valor_sensor').value),
            estado: false, // Por defecto apagado al crear
        };

        let success = false;
        if (editMode && id) {
            // Es una actualización, necesitamos obtener el estado anterior para no perderlo
            const devices = await fetchDevices();
            const oldDevice = devices.find(d => d.id == id);
            deviceData.estado = oldDevice ? oldDevice.estado : false; // Mantener el estado anterior
            success = await updateDevice(id, deviceData);
        } else {
            success = await createDevice(deviceData);
        }

        if (success) {
            resetForm();
            renderAdminTable();
            renderControlCards();
            renderMonitor(); // Actualizar monitoreo inmediatamente
        } else {
            alert('Error al guardar el dispositivo');
        }
    });

    // Botón para cancelar edición
    document.getElementById('cancelEdit').addEventListener('click', resetForm);

    // Limpiar intervalo cuando se cierra/recarga la página (buena práctica)
    window.addEventListener('beforeunload', () => {
        if (monitorInterval) clearInterval(monitorInterval);
    });
});