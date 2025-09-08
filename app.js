import {
  db, auth,
  ref, onValue, set, push, serverTimestamp,
  signInAnonymously, onAuthStateChanged,
  isDemo
} from './firebase.js';

// ===== UI Elements =====
const modeToggle = document.getElementById('modeToggle');
const modeLabel = document.getElementById('modeLabel');
const modeMetric = document.getElementById('modeMetric');
const connChip = document.getElementById('connChip');
const distanceEl = document.getElementById('distance');
const lastCmdEl = document.getElementById('lastCmd');
const fbStatus = document.getElementById('fbStatus');
const btnUp = document.getElementById('btnUp');
const btnDown = document.getElementById('btnDown');
const btnLeft = document.getElementById('btnLeft');
const btnRight = document.getElementById('btnRight');
const btnStop = document.getElementById('btnStop');
const btnCalib = document.getElementById('btnCalib');

// ===== Global Functions =====
function setModeUI(mode) {
  const isAuto = mode === 'auto';
  modeToggle.dataset.on = String(isAuto);
  modeToggle.setAttribute('aria-checked', String(isAuto));
  modeLabel.textContent = isAuto ? 'Auto' : 'Manual';
  modeMetric.textContent = isAuto ? 'Auto' : 'Manual';
  [btnUp, btnDown, btnLeft, btnRight, btnStop, btnCalib].forEach(b => b.disabled = isAuto);
}

async function setMode(mode) {
  if (isDemo) {
    setModeUI(mode);
    console.log(`Demo: Mode changed to ${mode}`);
    return;
  }
  try {
    await set(ref(db, 'control/mode'), mode);
    await push(ref(db, 'events/mode_changes'), { mode, ts: serverTimestamp() });
    console.log(`Mode changed to: ${mode}`);
  } catch (error) {
    console.error('Mode change failed:', error);
  }
}

async function sendCommand(command) {
  if (isDemo) {
    lastCmdEl.textContent = command.toUpperCase();
    console.log(`Demo: "${command}" command sent`);
    return;
  }
  try {
    const payload = { command, ts: serverTimestamp() };
    await push(ref(db, 'control/commands'), payload);
    lastCmdEl.textContent = command.toUpperCase();
    console.log(`Firebase: "${command}" command sent`);
  } catch (error) {
    console.error('Command send failed:', error);
  }
}

// ===== Firebase Initialization =====
async function initializeApp() {
  if (isDemo) {
    fbStatus.textContent = 'Firebase: (demo mode)';
    enableDemoMode();
    setupControls(); // Always setup controls
    return;
  }

  fbStatus.textContent = 'Firebase: initializing…';
  
  try {
    await signInAnonymously(auth);
    console.log('Firebase auth successful');
  } catch (e) {
    console.error('Firebase auth error:', e);
    fbStatus.textContent = 'Firebase: connection failed - running demo mode';
    enableDemoMode();
    setupControls();
    return;
  }

  onAuthStateChanged(auth, (user) => {
    if (user) {
      fbStatus.textContent = `Firebase: signed in (anon)`;
      bindRealtime();
    } else {
      fbStatus.textContent = 'Firebase: not signed in';
    }
  });
  
  setupControls(); // Always setup controls
}

function bindRealtime() {
  onValue(ref(db, 'sensors/distance_cm'), (snapshot) => {
    const v = snapshot.val();
    distanceEl.textContent = (typeof v === 'number') ? v.toFixed(0) : '—';
  }, (error) => {
    console.error('Distance listener error:', error);
    distanceEl.textContent = '—';
  });

  onValue(ref(db, 'status/connected'), (snapshot) => {
    const ok = !!snapshot.val();
    connChip.textContent = ok ? 'Connected' : 'Disconnected';
    connChip.className = `chip ${ok ? 'ok' : 'bad'}`;
  }, (error) => {
    console.error('Connection listener error:', error);
    connChip.textContent = 'Disconnected';
    connChip.className = 'chip bad';
  });

  onValue(ref(db, 'control/mode'), (snapshot) => {
    const mode = snapshot.val() === 'auto' ? 'auto' : 'manual';
    setModeUI(mode);
  }, (error) => {
    console.error('Mode listener error:', error);
    setModeUI('manual');
  });
}

// ===== Controls Setup (Always Works) =====
function setupControls() {
  // Mode Toggle
  modeToggle.addEventListener('click', () => {
    const nextMode = modeToggle.dataset.on === 'true' ? 'manual' : 'auto';
    setMode(nextMode);
  });
  
  modeToggle.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      modeToggle.click();
    }
  });

  // Button Controls
  btnUp.addEventListener('click', () => sendCommand('forward'));
  btnDown.addEventListener('click', () => sendCommand('backward'));
  btnLeft.addEventListener('click', () => sendCommand('left'));
  btnRight.addEventListener('click', () => sendCommand('right'));
  btnStop.addEventListener('click', () => sendCommand('stop'));
  btnCalib.addEventListener('click', () => sendCommand('calibrate'));

  // Keyboard Controls
  const keyMap = {
    ArrowUp: 'forward', KeyW: 'forward',
    ArrowDown: 'backward', KeyS: 'backward',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    Space: 'stop'
  };

  window.addEventListener('keydown', (e) => {
    const cmd = keyMap[e.code];
    if (cmd) {
      e.preventDefault();
      // Only work in manual mode
      if (modeToggle.dataset.on !== 'true') {
        sendCommand(cmd);
      }
    }
  });
  
  console.log('✅ Controls setup complete');
}

// ===== Demo Mode =====
function enableDemoMode() {
  setModeUI('manual');
  distanceEl.textContent = '—';
  connChip.textContent = 'Disconnected';
  connChip.className = 'chip bad';
  
  // Add demo indicator
  if (!document.getElementById('demoIndicator')) {
    const indicator = document.createElement('div');
    indicator.id = 'demoIndicator';
    indicator.style.cssText = `
      position: fixed; top: 10px; right: 10px;
      background: rgba(79,70,229,.15); color: #4f46e5;
      border: 1px solid rgba(79,70,229,.3);
      padding: 6px 12px; border-radius: 8px;
      font-size: 12px; font-weight: 600; z-index: 1000;
    `;
    indicator.textContent = 'DEMO MODE';
    document.body.appendChild(indicator);
  }
}

// ===== Start App =====
initializeApp().catch(error => {
  console.error('App initialization failed:', error);
  fbStatus.textContent = 'Error: Running in demo mode';
  enableDemoMode();
  setupControls();
});
