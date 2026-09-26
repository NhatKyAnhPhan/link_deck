const api = window.scrcpyLauncher;
const state = { devices: [], selectedSerial: '', session: { status: 'idle', fps: null } };
const elements = Object.fromEntries([
  'adb-state', 'device-count', 'device-list', 'device-empty', 'device-footnote',
  'selected-model', 'selected-serial', 'selected-device', 'session-badge', 'max-size',
  'print-fps', 'fps-value', 'fps-caption', 'fps-pulse', 'start-session', 'stop-session',
  'action-message', 'log-output', 'adb-path-label', 'scrcpy-path-label', 'toast',
].map(id => [id, document.getElementById(id)]));

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => elements.toast.classList.remove('visible'), 3200);
}

function addLog(entry) {
  const placeholder = elements['log-output'].querySelector('.log-placeholder');
  if (placeholder) placeholder.remove();
  const row = document.createElement('div');
  row.className = `log-entry${entry.stream === 'error' ? ' error' : ''}`;
  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = entry.time;
  const text = document.createElement('span');
  text.textContent = entry.text;
  row.append(time, text);
  elements['log-output'].append(row);
  elements['log-output'].scrollTop = elements['log-output'].scrollHeight;
  while (elements['log-output'].children.length > 70) elements['log-output'].firstElementChild.remove();
}

function renderDevices() {
  const list = elements['device-list'];
  list.replaceChildren();
  const usable = state.devices.filter(device => device.status === 'device');
  elements['device-count'].textContent = `${usable.length} THIẾT BỊ`;
  if (!state.devices.length) {
    list.append(elements['device-empty']);
    elements['device-footnote'].textContent = 'Đang chờ kết nối';
    elements['device-footnote'].previousElementSibling.className = 'tiny-led';
    return;
  }

  for (const device of state.devices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `device-card${device.serial === state.selectedSerial ? ' selected' : ''}${device.status !== 'device' ? ' unavailable' : ''}`;
    button.disabled = device.status !== 'device';
    const glyph = document.createElement('span');
    glyph.className = 'device-glyph';
    glyph.textContent = 'A';
    const main = document.createElement('span');
    main.className = 'device-main';
    const model = document.createElement('strong');
    model.textContent = device.model;
    const serial = document.createElement('code');
    serial.textContent = device.serial;
    main.append(model, serial);
    const status = document.createElement('span');
    status.className = `device-status${device.status === 'device' ? '' : ` ${device.status}`}`;
    status.textContent = device.status === 'device' ? 'SẴN SÀNG' : device.status.toUpperCase();
    button.append(glyph, main, status);
    button.addEventListener('click', () => {
      state.selectedSerial = device.serial;
      elements['selected-model'].textContent = device.model;
      elements['selected-serial'].textContent = device.serial;
      elements['selected-device'].querySelector('.selection-dot').classList.add('ready');
      renderDevices();
      updateControls();
    });
    list.append(button);
  }
  elements['device-footnote'].textContent = `${state.devices.length} thiết bị ADB được phát hiện`;
  elements['device-footnote'].previousElementSibling.className = 'tiny-led ready';
}

function setPathLabels(adbPath, scrcpyPath) {
  elements['adb-path-label'].textContent = `ADB: ${adbPath || 'chưa tìm thấy'}`;
  elements['adb-path-label'].title = adbPath || '';
  elements['scrcpy-path-label'].textContent = `scrcpy: ${scrcpyPath || 'chưa chọn'}`;
  elements['scrcpy-path-label'].title = scrcpyPath || '';
}

function renderSession(session) {
  state.session = session;
  const running = ['starting', 'running'].includes(session.status);
  elements['session-badge'].textContent = session.status === 'running' ? 'ĐANG CHẠY' : session.status === 'starting' ? 'ĐANG MỞ' : session.status === 'error' ? 'CÓ LỖI' : 'SẴN SÀNG';
  elements['session-badge'].className = `session-badge${running ? ' running' : session.status === 'error' ? ' error' : ''}`;
  elements['fps-value'].textContent = session.fps == null ? '--' : String(session.fps);
  elements['fps-caption'].textContent = running ? `Phiên ${session.serial}` : 'Chưa có phiên hoạt động';
  elements['fps-pulse'].classList.toggle('active', running);
  elements['stop-session'].disabled = !running;
  updateControls();
}

function updateControls() {
  elements['start-session'].disabled = !state.selectedSerial || ['starting', 'running'].includes(state.session.status);
}

async function refreshDevices() {
  const result = await api.refreshDevices();
  state.devices = result.devices || [];
  if (!state.devices.some(device => device.serial === state.selectedSerial && device.status === 'device')) {
    state.selectedSerial = '';
    elements['selected-model'].textContent = 'Chưa chọn thiết bị';
    elements['selected-serial'].textContent = '—';
    elements['selected-device'].querySelector('.selection-dot').classList.remove('ready');
  }
  renderDevices();
  setPathLabels(result.adbPath, elements['scrcpy-path-label'].title);
  const adbState = elements['adb-state'];
  const statusText = adbState.querySelector('span');
  statusText.textContent = result.adbPath ? (result.error ? 'ADB gặp lỗi' : 'ADB sẵn sàng') : 'Chưa tìm thấy ADB';
  adbState.className = `connection-state${result.adbPath && !result.error ? ' ready' : ' error'}`;
  if (result.error) elements['action-message'].textContent = result.error;
  else if (elements['action-message'].textContent.startsWith('Không tìm thấy')) elements['action-message'].textContent = '';
  return result;
}

document.getElementById('refresh-devices').addEventListener('click', async () => {
  try {
    await refreshDevices();
    showToast('Đã quét lại thiết bị ADB.');
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll('.size-presets button').forEach(button => {
  button.addEventListener('click', () => {
    elements['max-size'].value = button.dataset.size;
    document.querySelectorAll('.size-presets button').forEach(item => item.classList.toggle('active', item === button));
  });
});

elements['max-size'].addEventListener('input', () => {
  document.querySelectorAll('.size-presets button').forEach(button => button.classList.toggle('active', Number(button.dataset.size) === Number(elements['max-size'].value)));
});

document.getElementById('choose-adb').addEventListener('click', async () => {
  const selected = await api.choosePath('adb');
  if (selected) {
    await refreshDevices();
    showToast('Đã lưu đường dẫn adb.exe.');
  }
});

document.getElementById('choose-scrcpy').addEventListener('click', async () => {
  const selected = await api.choosePath('scrcpy');
  if (selected) {
    setPathLabels(elements['adb-path-label'].title, selected);
    showToast('Đã lưu đường dẫn scrcpy.exe.');
  }
});

elements['start-session'].addEventListener('click', async () => {
  elements['action-message'].textContent = '';
  const maxSize = Number(elements['max-size'].value);
  if (!Number.isInteger(maxSize) || maxSize < 0 || maxSize > 4096) {
    elements['action-message'].textContent = 'Kích thước phải là số nguyên từ 0 đến 4096.';
    return;
  }
  try {
    await api.startSession({
      serial: state.selectedSerial,
      maxSize,
      printFps: elements['print-fps'].checked,
    });
  } catch (error) {
    elements['action-message'].textContent = error.message;
  }
});

elements['stop-session'].addEventListener('click', () => api.stopSession());
api.onSessionUpdate(renderSession);
api.onSessionLog(addLog);

(async () => {
  const bootstrap = await api.bootstrap();
  state.devices = bootstrap.devices || [];
  renderSession(bootstrap.session);
  setPathLabels(bootstrap.adbPath, bootstrap.scrcpyPath);
  renderDevices();
  const status = elements['adb-state'];
  status.className = `connection-state${bootstrap.adbPath && !bootstrap.error ? ' ready' : ' error'}`;
  status.querySelector('span').textContent = bootstrap.adbPath && !bootstrap.error ? 'ADB sẵn sàng' : 'Chưa tìm thấy ADB';
  if (bootstrap.error) elements['action-message'].textContent = bootstrap.error;
  setInterval(() => refreshDevices().catch(() => {}), 5000);
})();