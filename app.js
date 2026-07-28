/**
 * Room-Scale Continuous Mouse Driver & Floor Plan Corner Digitizer
 * Core Application Logic
 */

// --- 1. Unit Conversion System ---
class UnitSystem {
  constructor(dpi = 800) {
    this.dpi = dpi;
    this.currentUnit = 'ft'; // 'ft', 'in', 'm', 'yd'
  }

  setDPI(dpi) {
    this.dpi = Math.max(50, Math.min(25600, dpi));
  }

  countsToInches(counts) {
    return counts / this.dpi;
  }

  convertFromInches(valInches, unit = this.currentUnit) {
    switch (unit) {
      case 'in': return valInches;
      case 'ft': return valInches / 12;
      case 'm':  return valInches * 0.0254;
      case 'yd': return valInches / 36;
      default:   return valInches / 12;
    }
  }

  convertToInches(val, unit = this.currentUnit) {
    switch (unit) {
      case 'in': return val;
      case 'ft': return val * 12;
      case 'm':  return val / 0.0254;
      case 'yd': return val * 36;
      default:   return val * 12;
    }
  }

  format(valInches, unit = this.currentUnit, decimals = 2) {
    const converted = this.convertFromInches(valInches, unit);
    return `${converted.toFixed(decimals)} ${unit}`;
  }

  formatArea(valSqInches, unit = this.currentUnit, decimals = 2) {
    if (unit === 'in') {
      return `${valSqInches.toFixed(decimals)} sq in`;
    } else if (unit === 'ft') {
      const sqFt = valSqInches / 144;
      return `${sqFt.toFixed(decimals)} sq ft`;
    } else if (unit === 'm') {
      const sqM = valSqInches * 0.00064516;
      return `${sqM.toFixed(decimals)} sq m`;
    } else if (unit === 'yd') {
      const sqYd = valSqInches / 1296;
      return `${sqYd.toFixed(decimals)} sq yd`;
    }
    return `${(valSqInches / 144).toFixed(decimals)} sq ft`;
  }
}

// --- 2. Application State & Telemetry ---
class AppState {
  constructor() {
    this.unitSystem = new UnitSystem(800);

    // Current Tracking Mode: 'floorplan' or 'freehand'
    this.mode = 'floorplan';

    // Live Cursor Position (Inches)
    this.posX = 0;
    this.posY = 0;

    // --- Floor Plan (Corner Mode) State ---
    this.rooms = []; // Array of closed room objects: { corners: [{x, y}], wallThickness, closed: true, areaSqInches }
    this.currentCorners = []; // Current room corners being placed: [{x, y}]
    this.orthoLock = true; // 90-degree right angle snapping
    this.showDimensions = true;
    this.wallThicknessInches = 6; // Exterior standard wall

    // --- Freehand Mode State ---
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
    this.lastEventTime = performance.now();

    // Calibration state
    this.isCalibrating = false;
    this.calibTicks = 0;
  }

  addCorner(pos = { x: this.posX, y: this.posY }) {
    let point = { x: pos.x, y: pos.y };

    // Apply Ortho-Lock (90-degree snap) relative to last corner
    if (this.orthoLock && this.currentCorners.length > 0) {
      const last = this.currentCorners[this.currentCorners.length - 1];
      const dx = point.x - last.x;
      const dy = point.y - last.y;

      if (Math.abs(dx) > Math.abs(dy)) {
        point.y = last.y; // Snap to horizontal wall
      } else {
        point.x = last.x; // Snap to vertical wall
      }
    }

    this.currentCorners.push(point);
  }

  undoLastCorner() {
    if (this.currentCorners.length > 0) {
      this.currentCorners.pop();
    }
  }

  closeRoom() {
    if (this.currentCorners.length >= 3) {
      const area = this.calculateArea(this.currentCorners);
      this.rooms.push({
        corners: [...this.currentCorners],
        wallThickness: this.wallThicknessInches,
        closed: true,
        areaSqInches: area
      });
      this.currentCorners = [];
    }
  }

  calculateArea(corners) {
    if (corners.length < 3) return 0;
    let area = 0;
    for (let i = 0; i < corners.length; i++) {
      const j = (i + 1) % corners.length;
      area += corners[i].x * corners[j].y;
      area -= corners[j].x * corners[i].y;
    }
    return Math.abs(area / 2);
  }

  getTotalFloorAreaSqInches() {
    let total = 0;
    for (const r of this.rooms) {
      total += r.areaSqInches || 0;
    }
    if (this.currentCorners.length >= 3) {
      total += this.calculateArea(this.currentCorners);
    }
    return total;
  }

  resetPosition() {
    this.posX = 0;
    this.posY = 0;
  }

  clearCanvas() {
    this.rooms = [];
    this.currentCorners = [];
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

    this.pixelsPerInch = 10; // Default: 10px per inch => 120px per foot
    this.panX = 0;
    this.panY = 0;

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

    if (this.panX === 0 && this.panY === 0) {
      this.panX = this.canvas.width / 2;
      this.panY = this.canvas.height / 2;
    }
  }

  setupEventListeners() {
    window.addEventListener('resize', () => this.resizeCanvas());

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;

      const mouseX = e.clientX - this.canvas.getBoundingClientRect().left;
      const mouseY = e.clientY - this.canvas.getBoundingClientRect().top;

      const worldX = (mouseX - this.panX) / this.pixelsPerInch;
      const worldY = (mouseY - this.panY) / this.pixelsPerInch;

      this.pixelsPerInch = Math.max(0.05, Math.min(500, this.pixelsPerInch * zoomFactor));

      this.panX = mouseX - worldX * this.pixelsPerInch;
      this.panY = mouseY - worldY * this.pixelsPerInch;

      this.updateScaleIndicator();
    }, { passive: false });

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

    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  worldToScreen(xInches, yInches) {
    return {
      x: this.panX + xInches * this.pixelsPerInch,
      y: this.panY + yInches * this.pixelsPerInch
    };
  }

  screenToWorld(xPx, yPx) {
    return {
      x: (xPx - this.panX) / this.pixelsPerInch,
      y: (yPx - this.panY) / this.pixelsPerInch
    };
  }

  resetView() {
    this.pixelsPerInch = 10;
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

    const currentUnit = this.state.unitSystem.currentUnit;
    let targetPx = 100;
    let targetInches = targetPx / this.pixelsPerInch;
    let targetConverted = this.state.unitSystem.convertFromInches(targetInches, currentUnit);

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

    ctx.fillStyle = '#0e121d';
    ctx.fillRect(0, 0, w, h);

    if (this.state.showGrid) {
      this.drawGrid();
    }

    this.drawOriginAxes();

    if (this.state.mode === 'floorplan') {
      this.drawFloorPlans();
    } else {
      this.drawFreehandPaths();
    }

    this.drawCurrentPosition();
    this.updateScaleIndicator();
  }

  drawGrid() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    let gridSpacingInches = 60; // 5 ft
    if (this.state.gridSpacing !== 'auto') {
      const ft = parseFloat(this.state.gridSpacing) || 5;
      gridSpacingInches = ft * 12;
    } else {
      const screenInchesWide = w / this.pixelsPerInch;
      if (screenInchesWide > 1200) gridSpacingInches = 240;
      else if (screenInchesWide > 360) gridSpacingInches = 120;
      else if (screenInchesWide > 120) gridSpacingInches = 60;
      else if (screenInchesWide > 36) gridSpacingInches = 12;
      else gridSpacingInches = 1;
    }

    const gridPx = gridSpacingInches * this.pixelsPerInch;

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

    for (let x = startX; x <= endX; x += gridSpacingInches) {
      const screenX = Math.round(this.panX + x * this.pixelsPerInch);
      ctx.beginPath();
      ctx.moveTo(screenX, 0);
      ctx.lineTo(screenX, h);
      ctx.stroke();

      if (gridPx > 40 && Math.abs(x) > 0.01) {
        const labelText = this.state.unitSystem.format(x, this.state.unitSystem.currentUnit, 0);
        ctx.fillText(labelText, screenX + 4, 14);
      }
    }

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

    ctx.strokeStyle = 'rgba(255, 23, 68, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, origin.y);
    ctx.lineTo(this.canvas.width, origin.y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.5)';
    ctx.beginPath();
    ctx.moveTo(origin.x, 0);
    ctx.lineTo(origin.x, this.canvas.height);
    ctx.stroke();

    ctx.fillStyle = 'rgba(0, 229, 255, 0.8)';
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '10px "Fira Code", monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('(0,0)', origin.x + 8, origin.y - 8);
  }

  // --- Render Architectural Floor Plan Rooms & Walls ---
  drawFloorPlans() {
    const ctx = this.ctx;

    // 1. Draw Completed Closed Rooms
    for (const room of this.state.rooms) {
      this.drawRoomPolygon(room.corners, true, room.wallThickness);
    }

    // 2. Draw Current Unfinished Room Corners & Preview Line
    if (this.state.currentCorners.length > 0) {
      const corners = [...this.state.currentCorners];

      // Live Cursor Target Point (with Ortho Snap applied)
      let liveTarget = { x: this.state.posX, y: this.state.posY };
      if (this.state.orthoLock && corners.length > 0) {
        const last = corners[corners.length - 1];
        const dx = liveTarget.x - last.x;
        const dy = liveTarget.y - last.y;
        if (Math.abs(dx) > Math.abs(dy)) liveTarget.y = last.y;
        else liveTarget.x = last.x;
      }

      // Draw active room polygon/line including live mouse preview
      const previewCorners = [...corners, liveTarget];
      this.drawRoomPolygon(previewCorners, false, this.state.wallThicknessInches);
    }
  }

  drawRoomPolygon(corners, isClosed = false, wallThickInches = 6) {
    const ctx = this.ctx;
    if (corners.length === 0) return;

    const screenPoints = corners.map(c => this.worldToScreen(c.x, c.y));
    const wallPx = Math.max(2, wallThickInches * this.pixelsPerInch);

    // 1. Fill Closed Room Interior (Blueprint Blue translucent)
    if (isClosed && screenPoints.length >= 3) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 180, 216, 0.12)';
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      ctx.closePath();
      ctx.fill();

      // Render Room Area Label at Center of Mass
      let cx = 0, cy = 0;
      screenPoints.forEach(p => { cx += p.x; cy += p.y; });
      cx /= screenPoints.length;
      cy /= screenPoints.length;

      const areaSqIn = this.state.calculateArea(corners);
      const areaText = this.state.unitSystem.formatArea(areaSqIn);

      ctx.font = '700 13px "Outfit", sans-serif';
      const textWidth = ctx.measureText(areaText).width;

      ctx.fillStyle = 'rgba(10, 13, 20, 0.85)';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1;
      ctx.roundRect(cx - textWidth / 2 - 10, cy - 14, textWidth + 20, 28, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#00e5ff';
      ctx.fillText(areaText, cx - textWidth / 2, cy + 4);
      ctx.restore();
    }

    // 2. Draw Thick Walls
    ctx.save();
    ctx.strokeStyle = isClosed ? '#29b6f6' : '#00e5ff';
    ctx.lineWidth = wallPx;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = isClosed ? 6 : 10;

    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    if (isClosed) ctx.closePath();
    ctx.stroke();
    ctx.restore();

    // 3. Draw Corner Node Markers & Vertex Numbers
    screenPoints.forEach((pt, idx) => {
      ctx.save();
      ctx.fillStyle = '#0e121d';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.font = '600 10px "Fira Code", monospace';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${idx + 1}`, pt.x - 3, pt.y + 3);
      ctx.restore();
    });

    // 4. Draw Wall Segment Dimension Labels along lines
    if (this.state.showDimensions) {
      const len = isClosed ? corners.length : corners.length - 1;
      for (let i = 0; i < len; i++) {
        const nextIdx = (i + 1) % corners.length;
        const p1 = corners[i];
        const p2 = corners[nextIdx];
        const sp1 = screenPoints[i];
        const sp2 = screenPoints[nextIdx];

        const dxInches = p2.x - p1.x;
        const dyInches = p2.y - p1.y;
        const wallLenInches = Math.sqrt(dxInches * dxInches + dyInches * dyInches);
        if (wallLenInches < 1) continue;

        const dimText = this.state.unitSystem.format(wallLenInches);

        // Midpoint of wall
        const midX = (sp1.x + sp2.x) / 2;
        const midY = (sp1.y + sp2.y) / 2;

        ctx.save();
        ctx.font = '600 11px "Fira Code", monospace';
        const txtWidth = ctx.measureText(dimText).width;

        ctx.fillStyle = 'rgba(10, 13, 20, 0.9)';
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.roundRect(midX - txtWidth / 2 - 6, midY - 10, txtWidth + 12, 20, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.fillText(dimText, midX - txtWidth / 2, midY + 4);
        ctx.restore();
      }
    }
  }

  drawFreehandPaths() {
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

    ctx.save();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 12;

    ctx.beginPath();
    ctx.arc(posScreen.x, posScreen.y, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(posScreen.x, posScreen.y, 2, 0, Math.PI * 2);
    ctx.fillStyle = '#00e5ff';
    ctx.fill();

    ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(posScreen.x - 14, posScreen.y);
    ctx.lineTo(posScreen.x + 14, posScreen.y);
    ctx.moveTo(posScreen.x, posScreen.y - 14);
    ctx.lineTo(posScreen.x, posScreen.y + 14);
    ctx.stroke();

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
    this.setupKeyPresses();
  }

  setupPointerLock() {
    this.btnLock.addEventListener('click', () => {
      document.body.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === document.body) {
        this.isLocked = true;
        this.statusIndicator.className = 'status-indicator active';
        this.statusText.textContent = 'Continuous Raw Input ACTIVE. Press [Space] or [Click] to mark room corner!';
        this.btnLock.innerHTML = `<span>TRACKING ACTIVE</span>`;
        this.btnLock.classList.remove('pulse-btn');
        this.btnLock.style.background = 'var(--accent-green)';
      } else {
        this.isLocked = false;
        this.statusIndicator.className = 'status-indicator inactive';
        this.statusText.textContent = 'Tracking Paused. Click "Start Continuous Tracking" to resume.';
        this.btnLock.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a4 4 0 0 0-4 4v4H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4zm-2 4a2 2 0 1 1 4 0v4h-4V6z"></path>
          </svg>
          <span>RESUME CONTINUOUS TRACKING</span>`;
        this.btnLock.classList.add('pulse-btn');
        this.btnLock.style.background = '';
      }
    });

    // Mouse Movement Handler
    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;

      const rawDx = e.movementX;
      const rawDy = e.movementY;

      if (rawDx === 0 && rawDy === 0) return;

      if (this.state.isCalibrating) {
        const deltaTicks = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
        this.state.calibTicks += deltaTicks;
        document.getElementById('calib-ticks').textContent = Math.round(this.state.calibTicks);
        return;
      }

      const deltaXInches = this.state.unitSystem.countsToInches(rawDx);
      const deltaYInches = this.state.unitSystem.countsToInches(rawDy);

      this.state.posX += deltaXInches;
      this.state.posY += deltaYInches;

      const stepDistInches = Math.sqrt(deltaXInches * deltaXInches + deltaYInches * deltaYInches);
      this.state.totalDistanceInches += stepDistInches;

      // Record Freehand stroke if active
      if (this.state.mode === 'freehand' && this.state.isDrawing) {
        if (!this.state.currentPath) {
          this.state.currentPath = {
            color: this.state.lineColor,
            widthInches: this.state.lineWidthInches,
            points: []
          };
        }
        this.state.currentPath.points.push({ x: this.state.posX, y: this.state.posY });
      }

      this.updateTelemetryCb();
    });

    // Left-Click drops a Room Corner Node when Pointer Lock is active
    document.addEventListener('click', (e) => {
      if (this.isLocked && this.state.mode === 'floorplan') {
        this.state.addCorner();
        this.updateTelemetryCb();
      }
    });
  }

  setupKeyPresses() {
    // Spacebar drops a Corner Node when in Pointer Lock
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.isLocked) {
        e.preventDefault();
        if (this.state.mode === 'floorplan') {
          this.state.addCorner();
          this.updateTelemetryCb();
        }
      }
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

    const totalAreaSqIn = state.getTotalFloorAreaSqInches();
    document.getElementById('val-area').textContent = state.unitSystem.formatArea(totalAreaSqIn);

    document.getElementById('val-dpi').textContent = `${state.unitSystem.dpi} DPI`;
  };

  const driver = new MouseDriverEngine(state, renderer, updateTelemetry);

  const animate = () => {
    renderer.render();
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);

  // --- UI Controls ---

  // 1. Mode Switching: Floor Plan (Corners) vs Freehand
  document.querySelectorAll('.mode-group .btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-group .btn-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;

      if (state.mode === 'floorplan') {
        document.getElementById('section-floorplan-tools').style.display = 'flex';
        document.getElementById('section-freehand-tools').style.display = 'none';
      } else {
        document.getElementById('section-floorplan-tools').style.display = 'none';
        document.getElementById('section-freehand-tools').style.display = 'flex';
      }
      updateTelemetry();
    });
  });

  // 2. Floor Plan Specific Tools
  document.getElementById('check-ortho').addEventListener('change', (e) => {
    state.orthoLock = e.target.checked;
  });

  document.getElementById('check-show-dims').addEventListener('change', (e) => {
    state.showDimensions = e.target.checked;
  });

  document.getElementById('select-wall-thick').addEventListener('change', (e) => {
    state.wallThicknessInches = parseFloat(e.target.value) || 6;
  });

  document.getElementById('btn-add-corner').addEventListener('click', () => {
    state.addCorner();
    updateTelemetry();
  });

  document.getElementById('btn-undo-corner').addEventListener('click', () => {
    state.undoLastCorner();
    updateTelemetry();
  });

  document.getElementById('btn-close-room').addEventListener('click', () => {
    state.closeRoom();
    updateTelemetry();
  });

  // 3. Unit Selector Buttons
  document.querySelectorAll('.unit-group .btn-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.unit-group .btn-toggle').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.unitSystem.currentUnit = btn.dataset.unit;
      updateTelemetry();
    });
  });

  // 4. DPI Sliders & Inputs
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

  // 5. Freehand Tools
  document.getElementById('check-draw').addEventListener('change', (e) => {
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

  // 6. Grid Controls
  document.getElementById('check-grid').addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
  });

  document.getElementById('select-grid-size').addEventListener('change', (e) => {
    state.gridSpacing = e.target.value;
  });

  // 7. Actions: Reset & Clear
  document.getElementById('btn-reset-pos').addEventListener('click', () => {
    state.resetPosition();
    updateTelemetry();
  });

  document.getElementById('btn-clear-canvas').addEventListener('click', () => {
    state.clearCanvas();
    updateTelemetry();
  });

  // 8. Viewport Controls
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

  // 9. DPI Calibration Modal Wizard
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
      state.isCalibrating = true;
      state.calibTicks = 0;
      btnCalibStart.textContent = 'Complete Test (Click when done dragging)';
      btnCalibStart.classList.add('pulse-btn');

      const selectedDistRadio = document.querySelector('input[name="calib-dist"]:checked');
      calibTargetInches = parseFloat(selectedDistRadio.value);

      if (!driver.isLocked) {
        document.body.requestPointerLock();
      }
    } else {
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

  // 10. Export Modal
  const modalExport = document.getElementById('modal-export');
  document.getElementById('btn-export').addEventListener('click', () => {
    modalExport.classList.add('active');
  });

  document.getElementById('modal-export-close-btn').addEventListener('click', () => {
    modalExport.classList.remove('active');
  });

  // Export PNG Blueprint
  document.getElementById('btn-export-png').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `floor_plan_blueprint_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    modalExport.classList.remove('active');
  });

  // Export SVG Vector Blueprint
  document.getElementById('btn-export-svg').addEventListener('click', () => {
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1000 -1000 2000 2000" style="background:#0e121d">\n`;

    for (const r of state.rooms) {
      if (r.corners.length < 3) continue;
      let d = `M ${r.corners[0].x * 10} ${r.corners[0].y * 10}`;
      for (let i = 1; i < r.corners.length; i++) {
        d += ` L ${r.corners[i].x * 10} ${r.corners[i].y * 10}`;
      }
      d += ` Z`;
      svgContent += `  <path d="${d}" fill="rgba(0,180,216,0.15)" stroke="#00e5ff" stroke-width="${r.wallThickness * 10}" stroke-linejoin="miter" />\n`;
    }

    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `floor_plan_vector_${Date.now()}.svg`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    modalExport.classList.remove('active');
  });

  // Export JSON CAD Trajectory
  document.getElementById('btn-export-json').addEventListener('click', () => {
    const data = {
      dpi: state.unitSystem.dpi,
      unit: state.unitSystem.currentUnit,
      totalFloorAreaSqFt: (state.getTotalFloorAreaSqInches() / 144).toFixed(2),
      rooms: state.rooms,
      freehandPaths: state.paths
    };
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = `floor_plan_cad_${Date.now()}.json`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
    modalExport.classList.remove('active');
  });

  updateTelemetry();
});
