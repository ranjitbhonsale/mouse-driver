# Continuous Room-Scale Mouse Tracking Driver & Infinite Visualizer

An advanced real-dimension mouse motion tracking system that enables continuous, unclamped hardware tracking across room-scale distances (e.g., 5 ft, 20 ft, 50 ft, 100 ft) without hitting monitor screen boundaries. 

Whether you're dragging a wireless mouse across a room-sized mousepad or measuring physical objects, this tool maps optical sensor counts into 1:1 real-world physical dimensions (Feet, Inches, Meters, Yards).

---

## Technical Overview

### 1. How Screen Edge Escape Works
Standard OS mouse cursors (e.g. `WM_MOUSEMOVE`) freeze when they hit monitor resolution edges (e.g. 1920x1080). This system bypasses cursor bounds using two methods:
- **Web App Driver (`app.js`)**: Employs the HTML5 **Pointer Lock API** (`requestPointerLock()`) to capture infinite, un-clamped raw relative motion (`movementX`, `movementY`).
- **Native Windows Driver (`raw_mouse_driver.py`)**: Uses low-level **Windows Raw Input API** (`RegisterRawInputDevices` + `WM_INPUT` via `ctypes`) to capture raw HID hardware packets directly from the optical sensor, bypassing OS mouse acceleration curves and screen boundary clamping.

### 2. DPI & Real-World Physical Math
Mouse sensors track displacement in hardware ticks/counts:
$$\text{Inches} = \frac{\text{Accumulated Hardware Ticks}}{\text{DPI}}$$
$$\text{Feet} = \frac{\text{Inches}}{12} \quad | \quad \text{Meters} = \text{Inches} \times 0.0254$$

For example, at **800 DPI**:
- Moving the mouse 1 inch produces 800 hardware ticks.
- Moving the mouse **5 feet (60 inches)** produces 48,000 hardware ticks.
- Moving the mouse **20 feet (240 inches)** produces 192,000 hardware ticks.

---

## Features

- 🎯 **Infinite Room-Scale Canvas**: Smooth Pan & Zoom viewport to visualize room-sized drawings.
- 📐 **Real-World Grid System**: Adaptive grid lines labeled in real-world dimensions (1 ft, 5 ft, 10 ft, 20 ft / meters).
- ⚡ **Live CAD Telemetry HUD**: Real-time X/Y position, accumulated path distance, live velocity, and active sensor DPI.
- 🔬 **Guided DPI Calibration Wizard**: Drag the mouse along a standard ruler for 6" or 12" to auto-calculate the exact DPI for 1:1 physical accuracy.
- 💾 **Multi-Format Session Export**: Export room drawings as high-resolution PNG images, vector SVG paths, or JSON trajectory logs.
- 🐍 **Standalone Python CLI Driver**: Background system driver for headless logging and stream tracking.

---

## Quick Start Guide

### Option A: Interactive Web Visualizer (Recommended)

1. Open `index.html` in your web browser (or run a local server):
   ```bash
   python -m http.server 8000
   ```
   Open `http://localhost:8000` in Google Chrome, Edge, or Firefox.

2. Click **START CONTINUOUS TRACKING** at the top right.
3. Move your mouse freely around your desk or room! Press `[Esc]` to pause tracking.
4. Drag canvas with Right-Click or Middle-Click to pan around your room-scale drawing.

### Option B: Native Windows Hardware Driver (`raw_mouse_driver.py`)

Run the standalone Win32 Raw Input Python driver script:

```bash
python raw_mouse_driver.py --dpi 800 --unit ft --log mouse_trajectory.json
```

**CLI Arguments:**
- `--dpi`: Mouse sensor DPI setting (default: `800`)
- `--unit`: Telemetry unit (`ft`, `in`, `m`, `yd`)
- `--log`: JSON output filename for recording trajectory coordinates

---

## DPI Calibration Guide

To ensure **1:1 physical accuracy** (e.g. 5 ft mouse drag = 5 ft on screen):

1. Click **Calibrate DPI** in the left panel.
2. Select **6 inches** or **12 inches**.
3. Align your mouse at the 0 mark of a physical ruler.
4. Click **Start Test**, drag mouse straight to the target mark, and click **Complete Test**.
5. Click **Apply Calculated DPI**. Your visualizer is now perfectly calibrated!
