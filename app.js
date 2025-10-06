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

  // Theme Elements
  const settingsBtn = document.getElementById('settingsBtn');
  const themePanel = document.getElementById('themePanel');
  const themePanelOverlay = document.getElementById('themePanelOverlay');
  const closeThemePanelBtn = document.getElementById('closeThemePanelBtn');
  const themeSwitcherBtns = document.querySelectorAll('.theme-switcher__btn');
  const colorSwatches = document.querySelectorAll('.color-swatch');

  // ===== Robot Status Tracking =====
  let robotConnected = false;
  let lastCommandSent = '';

  // ===== Theme Management =====
  function applyTheme(theme, accentColor) {
    document.body.dataset.theme = theme;
    themeSwitcherBtns.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.themeSet === theme);
    });
    
    const root = document.documentElement;
    root.style.setProperty('--accent-primary', accentColor);
    const accentGlow = hexToRgbA(accentColor, 0.4);
    root.style.setProperty('--accent-glow', accentGlow);
    
    colorSwatches.forEach(swatch => {
      swatch.classList.toggle('is-active', swatch.dataset.color === accentColor);
    });
  }

  function saveThemePreferences(theme, accentColor) {
    localStorage.setItem('robotDashboardTheme', JSON.stringify({ theme, accentColor }));
  }

  function loadThemePreferences() {
    const prefs = JSON.parse(localStorage.getItem('robotDashboardTheme'));
    const defaultPrefs = { theme: 'dark', accentColor: '#4f46e5' };
    applyTheme(prefs?.theme || defaultPrefs.theme, prefs?.accentColor || defaultPrefs.accentColor);
  }

  function setupTheming() {
    settingsBtn.addEventListener('click', () => {
      themePanel.classList.add('is-open');
      themePanelOverlay.classList.add('is-open');
    });
    
    const closePanel = () => {
      themePanel.classList.remove('is-open');
      themePanelOverlay.classList.remove('is-open');
    };
    
    closeThemePanelBtn.addEventListener('click', closePanel);
    themePanelOverlay.addEventListener('click', closePanel);
    
    themeSwitcherBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const theme = btn.dataset.themeSet;
        const currentAccent = document.documentElement.style.getPropertyValue('--accent-primary').trim();
        applyTheme(theme, currentAccent);
        saveThemePreferences(theme, currentAccent);
      });
    });
    
    colorSwatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        const accentColor = swatch.dataset.color;
        const currentTheme = document.body.dataset.theme;
        applyTheme(currentTheme, accentColor);
        saveThemePreferences(currentTheme, accentColor);
      });
    });
  }

  function hexToRgbA(hex, alpha) {
    let c;
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
      c = hex.substring(1).split('');
      if (c.length === 3) {
        c = [c[0], c[0], c[1], c[1], c[2], c[2]];
      }
      c = '0x' + c.join('');
      return `rgba(${[(c>>16)&255, (c>>8)&255, c&255].join(',')},${alpha})`;
    }
    throw new Error('Bad Hex');
  }

  // ===== Robot Control Functions =====
  function setModeUI(mode) {
    const isAuto = mode === 'auto';
    modeToggle.dataset.on = String(isAuto);
    modeToggle.setAttribute('aria-checked', String(isAuto));
    modeLabel.textContent = isAuto ? 'Auto' : 'Manual';
    modeMetric.textContent = isAuto ? 'Auto' : 'Manual';
    [btnUp, btnDown, btnLeft, btnRight, btnStop].forEach(b => b.disabled = isAuto);
  }

  async function setMode(mode) {
    try {
      await set(ref(db, 'control/mode'), mode);
      await push(ref(db, 'events/mode_changes'), { mode, ts: serverTimestamp() });
      console.log(`🔄 Mode changed to: ${mode}`);
    } catch (error) {
      console.error('Mode change failed:', error);
      fbStatus.textContent = 'Firebase: mode change failed';
    }
  }

  async function sendCommand(command) {
    lastCmdEl.textContent = command.toUpperCase();
    
    if (!robotConnected) {
      console.warn(`⚠️ Robot not connected - command "${command}" queued`);
    }
    
    try {
      // Write to the path your ESP32 reads from (/control/command)
      await set(ref(db, 'control/command'), command);
      
      // Keep the original logging structure for history (optional)
      const payload = { 
        command, 
        ts: serverTimestamp(),
        source: 'website'
      };
      await push(ref(db, 'control/commands'), payload);
      
      lastCommandSent = command;
      console.log(`📡 Command sent: ${command}`);
    } catch (error) {
      console.error('Command send failed:', error);
      lastCmdEl.textContent = 'ERROR';
      fbStatus.textContent = 'Firebase: command failed';
    }
  }


  // ===== Firebase Connection & Real-time Data =====
  async function initializeApp() {
    loadThemePreferences();
    setupTheming();
    setupControls();
    
    fbStatus.textContent = 'Firebase: connecting...';
    
    try {
      await signInAnonymously(auth);
      console.log('🔥 Firebase authenticated successfully');
      fbStatus.textContent = 'Firebase: authenticated';
    } catch (e) {
      console.error('Firebase auth error:', e);
      fbStatus.textContent = 'Firebase: authentication failed';
      return;
    }
    
    onAuthStateChanged(auth, (user) => {
      if (user) {
        fbStatus.textContent = 'Firebase: connected';
        bindRealtime();
        initializeRobotConnection();
      } else {
        fbStatus.textContent = 'Firebase: disconnected';
        robotConnected = false;
      }
    });
  }

  function bindRealtime() {
    // Listen for sensor data from robot
    onValue(ref(db, 'sensors/distance_cm'), (snapshot) => {
      const v = snapshot.val();
      const formattedV = (typeof v === 'number') ? v.toFixed(0) : '—';
      
      if (distanceEl.textContent !== formattedV) {
        distanceEl.textContent = formattedV;
        // Add visual feedback for data updates
        const parentMetric = distanceEl.closest('.metric__value');
        if (parentMetric) {
          parentMetric.classList.remove('value-change');
          void parentMetric.offsetWidth;
          parentMetric.classList.add('value-change');
        }
      }
    }, (error) => {
      console.error('Distance sensor listener error:', error);
      distanceEl.textContent = '—';
    });
    
    // Listen for robot connection status
    onValue(ref(db, 'status/connected'), (snapshot) => {
      const ok = !!snapshot.val();
      robotConnected = ok;
      connChip.textContent = ok ? 'Connected' : 'Disconnected';
      connChip.className = `chip ${ok ? 'chip--ok' : 'chip--bad'}`;
      
      if (ok) {
        console.log('🤖 Robot is online');
      } else {
        console.log('❌ Robot is offline');
      }
    }, (error) => {
      console.error('Connection status listener error:', error);
      robotConnected = false;
      connChip.textContent = 'Disconnected';
      connChip.className = 'chip chip--bad';
    });
    
    // Listen for mode changes
    onValue(ref(db, 'control/mode'), (snapshot) => {
      const mode = snapshot.val() === 'auto' ? 'auto' : 'manual';
      setModeUI(mode);
    }, (error) => {
      console.error('Mode listener error:', error);
      setModeUI('manual');
    });
  }

  async function initializeRobotConnection() {
    // Initialize robot status
    try {
      await set(ref(db, 'control/mode'), 'manual');
      await set(ref(db, 'status/website_connected'), true);
      console.log('🌐 Website connection established');
    } catch (error) {
      console.error('Failed to initialize robot connection:', error);
    }
  }

  // ===== Controls Setup =====
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
    
    // Movement Controls
    btnUp.addEventListener('click', () => sendCommand('forward'));
    btnDown.addEventListener('click', () => sendCommand('backward'));
    btnLeft.addEventListener('click', () => sendCommand('left'));
    btnRight.addEventListener('click', () => sendCommand('right'));
    btnStop.addEventListener('click', () => sendCommand('stop'));
    
    // Keyboard Controls (only in manual mode)
    const keyMap = {
      ArrowUp: 'forward', KeyW: 'forward',
      ArrowDown: 'backward', KeyS: 'backward', 
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      Space: 'stop'
    };
    
    window.addEventListener('keydown', (e) => {
      const cmd = keyMap[e.code];
      if (cmd && !e.repeat) {
        e.preventDefault();
        // Only allow keyboard control in manual mode
        if (modeToggle.dataset.on !== 'true') {
          sendCommand(cmd);
        }
      }
    });
    
    console.log('✅ Robot controls ready');
  }

  // ===== Initialize Application =====
  initializeApp().catch(error => {
    console.error('App initialization failed:', error);
    fbStatus.textContent = 'Error: Failed to start';
  });

  // ===== Connection Monitoring =====
  window.addEventListener('beforeunload', async () => {
    try {
      await set(ref(db, 'status/website_connected'), false);
    } catch (error) {
      console.error('Failed to update disconnect status:', error);
    }
  });