/**
 * Room-Scale Continuous Mouse Driver & Infinite CAD Visualizer
 * Core Application Logic
 */

// --- 1. Unit Conversion System ---
class UnitSystem {
  constructor(dpi = 800) {
    this.dpi = dpi; // Hardware counts per inch
    this.currentUnit = 'ft'; // 'ft', 'in', 'm', 'yd'
  }

  setDPI(dpi) {
    this.dpi = Math.max(50, Math.min(25600, dpi));
  }

  // Raw counts to Inches
  countsToInches(counts) {
    return counts / this.dpi;
  }

  // Inches to Raw counts
  inchesToCounts(inches) {
    return inches * this.dpi;
  }

  // Convert Inches to chosen unit
  convertFromInches(valInches, unit = this.currentUnit) {
    switch (unit) {
      case 'in': return valInches;
      case 'ft': return valInches / 12;
      case 'm':  return valInches * 0.0254;
      case 'yd': return valInches / 36;
      default:   return valInches / 12;
    }
  }

  // Convert unit to Inches
  convertToInches(val, unit = this.currentUnit) {
    switch (unit) {
      case 'in': return val;
      case 'ft': return val * 12;
      case 'm':  return val / 0.0254;
      case 'yd': return val * 36;
      default:   return val * 12;
    }
  }

  // Format value with unit string
  format(valInches, unit = this.currentUnit, decimals = 2) {
    const converted = this.convertFromInches(valInches, unit);
    return `${converted.toFixed(decimals)} ${unit}`;
  }

  getUnitLabel(unit = this.currentUnit) {
    switch (unit) {
      case 'in': return 'Inches (in)';
      case 'ft': return 'Feet (ft)';
      case 'm':  return 'Meters (m)';
      case 'yd': return 'Yards (yd)';
      default:   return 'Feet (ft)';
    }
  }
}

// --- 2. Application State & Telemetry ---
class AppState {
  constructor() {
    this.unitSystem = new UnitSystem(800);
    
    // Position in Inches (0,0 is Origin)
    this.posX = 0; // Inches
    this.posY = 0; // Inches
    
    // Path history: Array of stroke objects { color, widthInches, points: [{x, y}] }
    this.paths = [];
    this.currentPath = null;
    this.isDrawing = true;
    this.lineColor = '#00e5ff';
    this.lineWidthInches = 0.5;

    // Grid & View settings
    this.showGrid = true;
    this.gridSpacing = '5'; // 'auto', '1', '5', '10', '20' (in feet)

    // Telemetry
    this.totalDistanceInches = 0;
    this.currentSpeedInchesPerSec = 0;
    this.lastEventTime = performance.now();

    // Calibration state
    this.isCalibrating = false;
    this.calibStartPos = { x: 0, y: 0 };
    this.calibTicks = 0;
  }

  resetPosition() {
    this.posX = 0;
    this.posY = 0;
    if (this.currentPath && this.currentPath.points.length > 0) {
      this.currentPath.points.push({ x: 0, y: 0 });
    }
  }

  clearCanvas() {
    this.paths = [];
    this.currentPath = null;
    this.totalDistanceInches = 0;
  }
}

// --- 3. Viewport & Canvas Renderer Engine ---
class ViewportRenderer {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.state = state;

    // Viewport transform
    this.zoom = 100; // Pixels per Inch (default scale: 100px = 1 inch, or scaled for view)
    // Dynamic scale: 1 foot = 12 * zoom pixels.
    // Base scale: 120 pixels per foot => 10 px per inch
    this.pixelsPerInch = 10; 

    // Viewport Pan Offset in Canvas Pixels (center of canvas is origin)
    this.panX = 0;
    this.panY = 0;

    // Panning interaction state
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    this.setupEventListeners();
    this.resizeCanvas();
  }

  resizeCanvas() {
    const container = this.canvas.parentElement;
    this.canvas.width = container.clientWidth;
    this.canvas.height = container.clientHeight;
    
    // Set initial pan origin to center if first time
    if (this.panX === 0 && this.panY === 0) {
      this.panX = this.canvas.width / 2;
      this.panY = this.canvas.height / 2;
    }
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.resizeCanvas());

    // Mouse Wheel Zooming
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      
      const mouseX = e.clientX - this.canvas.getBoundingClientRect().left;
      const mouseY = e.clientY - this.canvas.getBoundingClientRect().top;

      // World point under cursor before zoom
      const worldX = (mouseX - this.panX) / this.pixelsPerInch;
      const worldY = (mouseY - this.panY) / this.pixelsPerInch;

      // Adjust scale (clamp pixels per inch between 0.1 and 500)
      this.pixelsPerInch = Math.max(0.05, Math.min(500, this.pixelsPerInch * zoomFactor));

      // Adjust pan so world point remains under cursor
      this.panX = mouseX - worldX * this.pixelsPerInch;
      this.panY = mouseY - worldY * this.pixelsPerInch;

      this.updateScaleIndicator();
    }, { passive: false });

    // Canvas Drag Panning (Right click or Middle click or Space+Drag)
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 || e.button === 1 || e.shiftKey) {
        this.isPanning = true;
        this.panStartX = e.clientX - this.panX;
        this.panStartY = e.clientY - this.panY;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 2 || e.button === 1 || this.isPanning) {
        this.isPanning = false;
      }
    });

    // Disable context menu on canvas for smooth right-click pan
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Convert World Coordinates (Inches) to Screen Coordinates (Pixels)
  worldToScreen(xInches, yInches) {
    return {
      x: this.panX + xInches * this.pixelsPerInch,
      y: this.panY + yInches * this.pixelsPerInch
    };
  }

  // Convert Screen Coordinates (Pixels) to World Coordinates (Inches)
  screenToWorld(xPx, yPx) {
    return {
      x: (xPx - this.panX) / this.pixelsPerInch,
      y: (yPx - this.panY) / this.pixelsPerInch
    };
  }

  resetView() {
    this.pixelsPerInch = 10; // Default: 10px per inch => 120px per foot
    this.panX = this.canvas.width / 2;
    this.panY = this.canvas.height / 2;
    this.updateScaleIndicator();
  }

  centerOrigin() {
    this.panX = this.canvas.width / 2 - this.state.posX * this.pixelsPerInch;
    this.panY = this.canvas.height / 2 - this.state.posY * this.pixelsPerInch;
  }

  updateScaleIndicator() {
    const scaleBar = document.getElementById('scale-bar');
    const scaleText = document.getElementById('scale-text');
    if (!scaleBar || !scaleText) return;

    // Find a nice clean reference distance in feet/inches
    const currentUnit = this.state.unitSystem.currentUnit;
    let targetPx = 100; // Target width for scale bar
    let targetInches = targetPx / this.pixelsPerInch;
    let targetConverted = this.state.unitSystem.convertFromInches(targetInches, currentUnit);

    // Round targetConverted to nearest nice number (1, 2, 5, 10, 20, 50, 100, etc.)
    const pow = Math.pow(10, Math.floor(Math.log10(targetConverted || 1)));
    let niceVal = Math.round(targetConverted / pow) * pow;
    if (niceVal <= 0) niceVal = 1;

    let niceInches = this.state.unitSystem.convertToInches(niceVal, currentUnit);
    let actualPx = niceInches * this.pixelsPerInch;

    scaleBar.style.width = `${Math.round(actualPx)}px`;
    scaleText.textContent = `${niceVal} ${currentUnit}`;
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear background
    ctx.fillStyle = '#0e121d';
    ctx.fillRect(0, 0, w, h);

    // 1. Draw Real-World Grid
    if (this.state.showGrid) {
      this.drawGrid();
    }

    // 2. Draw Origin Axes Crosshair
    this.drawOriginAxes();

    // 3. Draw Recorded Paths
    this.drawPaths();

    // 4. Draw Current Position Cursor & Telemetry Ring
    this.drawCurrentPosition();

    // Update Scale Bar HUD
    this.updateScaleIndicator();
  }

  drawGrid() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Determine grid spacing in Inches
    let gridSpacingInches = 60; // Default 5 feet = 60 inches
    if (this.state.gridSpacing !== 'auto') {
      const ft = parseFloat(this.state.gridSpacing) || 5;
      gridSpacingInches = ft * 12;
    } else {
      // Auto adaptive grid spacing based on zoom level
      const screenInchesWide = w / this.pixelsPerInch;
      if (screenInchesWide > 1200) gridSpacingInches = 240; // 20 ft
      else if (screenInchesWide > 360) gridSpacingInches = 120; // 10 ft
      else if (screenInchesWide > 120) gridSpacingInches = 60; // 5 ft
      else if (screenInchesWide > 36) gridSpacingInches = 12; // 1 ft
      else gridSpacingInches = 1; // 1 in
    }

    const gridPx = gridSpacingInches * this.pixelsPerInch;

    // Visible bounds in world coordinates (Inches)
    const topLeft = this.screenToWorld(0, 0);
    const bottomRight = this.screenToWorld(w, h);

    const startX = Math.floor(topLeft.x / gridSpacingInches) * gridSpacingInches;
    const endX = Math.ceil(bottomRight.x / gridSpacingInches) * gridSpacingInches;
    const startY = Math.floor(topLeft.y / gridSpacingInches) * gridSpacingInches;
    const endY = Math.ceil(bottomRight.y / gridSpacingInches) * gridSpacingInches;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.font = '10px "Fira Code", monospace';
    ctx.fillStyle = 'rgba(138, 153, 181, 0.4)';

    // Vertical grid lines
    for (let x = startX; x <= endX; x += gridSpacingInches) {
      const screenX = Math.round(this.panX + x * this.pixelsPerInch);
      ctx.beginPath();
      ctx.moveTo(screenX, 0);
      ctx.lineTo(screenX, h);
      ctx.stroke();

      // Grid coordinate label
      if (gridPx > 40 && Math.abs(x) > 0.01) {
        const labelText = this.state.unitSystem.format(x, this.state.unitSystem.currentUnit, 0);
        ctx.fillText(labelText, screenX + 4, 14);
      }
    }

    // Horizontal grid lines
    for (let y = startY; y <= endY; y += gridSpacingInches) {
      const screenY = Math.round(this.panY + y * this.pixelsPerInch);
      ctx.beginPath();
      ctx.moveTo(0, screenY);
      ctx.lineTo(w, screenY);
      ctx.stroke();

      if (gridPx > 40 && Math.abs(y) > 0.01) {
        const labelText = this.state.unitSystem.format(y, this.state.unitSystem.currentUnit, 0);
        ctx.fillText(labelText, 6, screenY - 4);
      }
    }
  }

  drawOriginAxes() {
    const ctx = this.ctx;
    const origin = this.worldToScreen(0, 0);

    // X Axis (Red/Magenta)
    ctx.strokeStyle = 'rgba(255, 23, 68, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, origin.y);
    ctx.lineTo(this.canvas.width, origin.y);
    ctx.stroke();

    // Y Axis (Green/Cyan)
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
    ctx.beginPath();
    ctx.moveTo(origin.x, 0);
    ctx.lineTo(origin.x, this.canvas.height);
    ctx.stroke();

    // Origin Badge
    ctx.fillStyle = 'rgba(0, 229, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '10px "Fira Code", monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('(0,0)', origin.x + 8, origin.y - 8);
  }

  drawPaths() {
    const ctx = this.ctx;
    const allPaths = [...this.state.paths];
    if (this.state.currentPath) allPaths.push(this.state.currentPath);

    for (const path of allPaths) {
      if (path.points.length < 2) continue;

      ctx.save();
      ctx.strokeStyle = path.color;
      ctx.lineWidth = Math.max(1, path.widthInches * this.pixelsPerInch);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = path.color;
      ctx.shadowBlur = 8;

      ctx.beginPath();
      const firstScreen = this.worldToScreen(path.points[0].x, path.points[0].y);
      ctx.moveTo(firstScreen.x, firstScreen.y);

      for (let i = 1; i < path.points.length; i++) {
        const ptScreen = this.worldToScreen(path.points[i].x, path.points[i].y);
        ctx.lineTo(ptScreen.x, ptScreen.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  drawCurrentPosition() {
    const ctx = this.ctx;
    const posScreen = this.worldToScreen(this.state.posX, this.state.posY);

    // Glowing Target Marker
    ctx.save();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 12;

    // Target Circles
    ctx.beginPath();
    ctx.arc(posScreen.x, posScreen.y, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(posScreen.x, posScreen.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#00e5ff';
    ctx.fill();

    // Crosshair Lines
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(posScreen.x - 14, posScreen.y);
    ctx.lineTo(posScreen.x + 14, posScreen.y);
    ctx.moveTo(posScreen.x, posScreen.y - 14);
    ctx.lineTo(posScreen.x, posScreen.y + 14);
    ctx.stroke();

    // Live Position HUD Badge next to cursor
    const xFormatted = this.state.unitSystem.format(this.state.posX);
    const yFormatted = this.state.unitSystem.format(this.state.posY);
    const badgeText = `[${xFormatted}, ${yFormatted}]`;

    ctx.font = '11px "Fira Code", monospace';
    const textWidth = ctx.measureText(badgeText).width;

    ctx.fillStyle = 'rgba(10, 13, 20, 0.85)';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.roundRect(posScreen.x + 16, posScreen.y - 20, textWidth + 12, 22, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(badgeText, posScreen.x + 22, posScreen.y - 5);

    ctx.restore();
  }
}

// --- 4. Pointer Lock Mouse Input Driver ---
class MouseDriverEngine {
  constructor(state, renderer, updateTelemetryCb) {
    this.state = state;
    this.renderer = renderer;
    this.updateTelemetryCb = updateTelemetryCb;
    this.isLocked = false;

    this.btnLock = document.getElementById('btn-lock');
    this.statusIndicator = document.getElementById('status-indicator');
    this.statusText = document.getElementById('status-text');

    this.setupPointerLock();
  }

  setupPointerLock() {
    this.btnLock.addEventListener('click', () => {
      document.body.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === document.body) {
        this.isLocked = true;
        this.statusIndicator.className = 'status-indicator active';
        this.statusText.textContent = 'Continuous Raw Input ACTIVE. Move mouse anywhere in room! Press [Esc] to exit.';
        this.btnLock.innerHTML = `<span>TRACKING ACTIVE</span>`;
        this.btnLock.classList.remove('pulse-btn');
        this.btnLock.style.background = 'var(--accent-green)';
      } else {
        this.isLocked = false;
        this.statusIndicator.className = 'status-indicator inactive';
        this.statusText.textContent = 'Tracking Paused. Click "Start Continuous Tracking" to lock mouse and resume.';
        this.btnLock.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a4 4 0 0 0-4 4v4H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4zm-2 4a2 2 0 1 1 4 0v4h-4V6z"></path>
          </svg>
          <span>RESUME CONTINUOUS TRACKING</span>`;
        this.btnLock.classList.add('pulse-btn');
        this.btnLock.style.background = '';
      }
    });

    // Handle Unclamped Continuous Mouse Movement
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;

      const rawDx = e.movementX;
      const rawDy = e.movementY;

      if (rawDx === 0 && rawDy === 0) return;

      // Handle Calibration Mode
      if (this.state.isCalibrating) {
        const deltaTicks = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
        this.state.calibTicks += deltaTicks;
        document.getElementById('calib-ticks').textContent = Math.round(this.state.calibTicks);
        return;
      }

      // Convert raw hardware counts to Inches
      const deltaXInches = this.state.unitSystem.countsToInches(rawDx);
      const deltaYInches = this.state.unitSystem.countsToInches(rawDy);

      // Accumulate World Position
      this.state.posX += deltaXInches;
      this.state.posY += deltaYInches;

      // Accumulate Path Distance
      const stepDistInches = Math.sqrt(deltaXInches * deltaXInches + deltaYInches * deltaYInches);
      this.state.totalDistanceInches += stepDistInches;

      // Calculate Speed
      const now = performance.now();
      const dt = (now - this.state.lastEventTime) / 1000;
      if (dt > 0) {
        this.state.currentSpeedInchesPerSec = stepDistInches / dt;
      }
      this.state.lastEventTime = now;

      // Record Vector Stroke
      if (this.state.isDrawing) {
        if (!this.state.currentPath) {
          this.state.currentPath = {
            color: this.state.lineColor,
            widthInches: this.state.lineWidthInches,
            points: []
          };
        }
        this.state.currentPath.points.push({ x: this.state.posX, y: this.state.posY });
      }

      // Automatically keep origin centered if out of viewport
      // this.renderer.centerOrigin();

      this.updateTelemetryCb();
    });
  }
}

// --- 5. Main Controller & Event Binding ---
document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('main-canvas');
  const state = new AppState();
  const renderer = new ViewportRenderer(canvas, state);

  // Telemetry Updater
  const updateTelemetry = () => {
    document.getElementById('val-x').textContent = state.unitSystem.format(state.posX);
    document.getElementById('val-y').textContent = state.unitSystem.format(state.posY);
    document.getElementById('val-distance').textContent = state.unitSystem.format(state.totalDistanceInches);

    const speedUnitStr = state.unitSystem.currentUnit + '/s';
    const speedConverted = state.unitSystem.convertFromInches(state.currentSpeedInchesPerSec);
    document.getElementById('val-speed').textContent = `${speedConverted.toFixed(2)} ${speedUnitStr}`;

    document.getElementById('val-dpi').textContent = `${state.unitSystem.dpi} DPI`;
  };

  const driver = new MouseDriverEngine(state, renderer, updateTelemetry);

  // Animation Loop
  const animate = () => {
    renderer.render();
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);

  // --- UI Controls Event Listeners ---

  // 1. Unit Selector Buttons
  document.querySelectorAll('.unit-group .btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.unit-group .btn-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.unitSystem.currentUnit = btn.dataset.unit;
      updateTelemetry();
    });
  });

  // 2. DPI Sliders & Inputs
  const sliderDpi = document.getElementById('slider-dpi');
  const inputDpi = document.getElementById('input-dpi');

  sliderDpi.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    inputDpi.value = val;
    state.unitSystem.setDPI(val);
    updateTelemetry();
  });

  inputDpi.addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    sliderDpi.value = val;
    state.unitSystem.setDPI(val);
    updateTelemetry();
  });

  // 3. Drawing Controls
  const checkDraw = document.getElementById('check-draw');
  checkDraw.addEventListener('change', (e) => {
    state.isDrawing = e.target.checked;
    if (!state.isDrawing && state.currentPath) {
      state.paths.push(state.currentPath);
      state.currentPath = null;
    }
  });

  const pickerColor = document.getElementById('picker-color');
  pickerColor.addEventListener('input', (e) => {
    state.lineColor = e.target.value;
    if (state.currentPath) {
      state.paths.push(state.currentPath);
      state.currentPath = null;
    }
  });

  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.color;
      pickerColor.value = color;
      state.lineColor = color;
      if (state.currentPath) {
        state.paths.push(state.currentPath);
        state.currentPath = null;
      }
    });
  });

  const sliderWidth = document.getElementById('slider-width');
  const valWidth = document.getElementById('val-width');
  sliderWidth.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    state.lineWidthInches = val;
    valWidth.textContent = `${val}"`;
  });

  // 4. Grid Controls
  const checkGrid = document.getElementById('check-grid');
  checkGrid.addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
  });

  const selectGridSize = document.getElementById('select-grid-size');
  selectGridSize.addEventListener('change', (e) => {
    state.gridSpacing = e.target.value;
  });

  // 5. Actions: Reset & Clear
  document.getElementById('btn-reset-pos').addEventListener('click', () => {
    state.resetPosition();
    updateTelemetry();
  });

  document.getElementById('btn-clear-canvas').addEventListener('click', () => {
    state.clearCanvas();
    updateTelemetry();
  });

  // 6. Viewport Controls (Zoom In, Zoom Out, Reset, Center)
  document.getElementById('btn-zoom-in').addEventListener('click', () => {
    renderer.pixelsPerInch *= 1.25;
    renderer.updateScaleIndicator();
  });

  document.getElementById('btn-zoom-out').addEventListener('click', () => {
    renderer.pixelsPerInch *= 0.8;
    renderer.updateScaleIndicator();
  });

  document.getElementById('btn-zoom-reset').addEventListener('click', () => {
    renderer.resetView();
  });

  document.getElementById('btn-center').addEventListener('click', () => {
    renderer.centerOrigin();
  });

  // 7. DPI Calibration Modal Wizard
  const modalCalib = document.getElementById('modal-calibration');
  const btnCalibrate = document.getElementById('btn-calibrate');
  const btnCalibClose = document.getElementById('modal-close-btn');
  const btnCalibCancel = document.getElementById('btn-calib-cancel');
  const btnCalibStart = document.getElementById('btn-calib-start');
  const btnCalibApply = document.getElementById('btn-calib-apply');
  const calibResultBox = document.getElementById('calib-result');

  let calibTargetInches = 6;
  let calculatedDpi = 800;

  btnCalibrate.addEventListener('click', () => {
    modalCalib.classList.add('active');
    state.isCalibrating = false;
    state.calibTicks = 0;
    document.getElementById('calib-ticks').textContent = '0';
    calibResultBox.style.display = 'none';
    btnCalibStart.textContent = 'Start Test';
    btnCalibApply.style.display = 'none';
  });

  const closeCalibModal = () => {
    modalCalib.classList.remove('active');
    state.isCalibrating = false;
  };

  btnCalibClose.addEventListener('click', closeCalibModal);
  btnCalibCancel.addEventListener('click', closeCalibModal);

  btnCalibStart.addEventListener('click', () => {
    if (!state.isCalibrating) {
      // Start test
      state.isCalibrating = true;
      state.calibTicks = 0;
      btnCalibStart.textContent = 'Complete Test (Click when done dragging)';
      btnCalibStart.classList.add('pulse-btn');
      
      const selectedDistRadio = document.querySelector('input[name="calib-dist"]:checked');
      calibTargetInches = parseFloat(selectedDistRadio.value);

      // Lock mouse automatically if not locked
      if (!driver.isLocked) {
        document.body.requestPointerLock();
      }
    } else {
      // Complete test
      state.isCalibrating = false;
      btnCalibStart.textContent = 'Restart Test';
      btnCalibStart.classList.remove('pulse-btn');

      if (state.calibTicks > 0) {
        calculatedDpi = Math.round(state.calibTicks / calibTargetInches);
        document.getElementById('calib-calculated-dpi').textContent = `${calculatedDpi} DPI`;
        calibResultBox.style.display = 'block';
        btnCalibApply.style.display = 'inline-flex';
      }
    }
  });

  btnCalibApply.addEventListener('click', () => {
    state.unitSystem.setDPI(calculatedDpi);
    inputDpi.value = calculatedDpi;
    sliderDpi.value = calculatedDpi;
    updateTelemetry();
    closeCalibModal();
  });

  // 8. Export Options Modal
  const modalExport = document.getElementById('modal-export');
  document.getElementById('btn-export').addEventListener('click', () => {
    modalExport.classList.add('active');
  });

  document.getElementById('modal-export-close-btn').addEventListener('click', () => {
    modalExport.classList.remove('active');
  });

  // Export PNG
  document.getElementById('btn-export-png').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `room_scale_drawing_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    modalExport.classList.remove('active');
  });

  // Export JSON Trajectory Log
  document.getElementById('btn-export-json').addEventListener('click', () => {
    const data = {
      dpi: state.unitSystem.dpi,
      unit: state.unitSystem.currentUnit,
      totalDistanceInches: state.totalDistanceInches,
      totalDistanceFormatted: state.unitSystem.format(state.totalDistanceInches),
      paths: state.paths
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `mouse_trajectory_${Date.now()}.json`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    modalExport.classList.remove('active');
  });

  // Export SVG Vector File
  document.getElementById('btn-export-svg').addEventListener('click', () => {
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1000 -1000 2000 2000" style="background:#0e121d">\n`;
    
    const allPaths = [...state.paths];
    if (state.currentPath) allPaths.push(state.currentPath);

    for (const p of allPaths) {
      if (p.points.length < 2) continue;
      let d = `M ${p.points[0].x * 10} ${p.points[0].y * 10}`;
      for (let i = 1; i < p.points.length; i++) {
        d += ` L ${p.points[i].x * 10} ${p.points[i].y * 10}`;
      }
      svgContent += `  <path d="${d}" stroke="${p.color}" stroke-width="${p.widthInches * 10}" fill="none" stroke-linecap="round" stroke-linejoin="round" />\n`;
    }
    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `room_scale_vector_${Date.now()}.svg`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    modalExport.classList.remove('active');
  });

  updateTelemetry();
});
