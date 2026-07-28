"""
Standalone Low-Level Windows Raw Input Mouse Driver
Continuously reads raw unscaled hardware delta ticks directly from HID mouse packets.
Bypasses OS mouse acceleration and screen boundary limits (e.g. 1920x1080).
Allows continuous room-scale tracking (e.g., 5ft, 20ft, 50ft movement).

Author: Antigravity AI
"""

import sys
import time
import math
import json
import os
import argparse
from ctypes import (
    Structure, c_ushort, c_ulong, c_long, c_uint, c_int, c_void_p, c_char_p,
    byref, sizeof, windll, WINFUNCTYPE, POINTER
)

# --- Win32 API Constants & Data Structures ---
WM_INPUT = 0x00FF
WM_CLOSE = 0x0010
WM_DESTROY = 0x0002

RIDEV_INPUTSINK = 0x00000100
RID_INPUT = 0x10000003

RIM_TYPEMOUSE = 0

class RAWINPUTDEVICE(Structure):
    _fields_ = [
        ("usUsagePage", c_ushort),
        ("usUsage", c_ushort),
        ("dwFlags", c_ulong),
        ("hwndTarget", c_void_p)
    ]

class RAWINPUTHEADER(Structure):
    _fields_ = [
        ("dwType", c_ulong),
        ("dwSize", c_ulong),
        ("hDevice", c_void_p),
        ("wParam", c_void_p)
    ]

class RAWMOUSE(Structure):
    _fields_ = [
        ("usFlags", c_ushort),
        ("ulButtons", c_ulong),
        ("usButtonFlags", c_ushort),
        ("usButtonData", c_ushort),
        ("ulRawButtons", c_ulong),
        ("lLastX", c_long),
        ("lLastY", c_long),
        ("ulExtraInformation", c_ulong)
    ]

class RAWINPUT_MOUSE(Structure):
    _fields_ = [
        ("header", RAWINPUTHEADER),
        ("mouse", RAWMOUSE)
    ]

# Win32 Function Signatures
user32 = windll.user32
kernel32 = windll.kernel32

RegisterRawInputDevices = user32.RegisterRawInputDevices
RegisterRawInputDevices.argtypes = [POINTER(RAWINPUTDEVICE), c_uint, c_uint]
RegisterRawInputDevices.restype = c_int

GetRawInputData = user32.GetRawInputData
GetRawInputData.argtypes = [c_void_p, c_uint, c_void_p, POINTER(c_uint), c_uint]
GetRawInputData.restype = c_uint

DefWindowProc = user32.DefWindowProcW


# --- Continuous Hardware Driver Class ---
class RawMouseDriver:
    def __init__(self, dpi=800, unit='ft', log_file="mouse_trajectory.json"):
        self.dpi = float(dpi)
        self.unit = unit  # 'ft', 'in', 'm', 'yd'
        self.log_file = log_file

        # Raw hardware counts
        self.accumulated_x_ticks = 0
        self.accumulated_y_ticks = 0

        # Physical accumulated position (Inches)
        self.pos_x_inches = 0.0
        self.pos_y_inches = 0.0
        self.total_distance_inches = 0.0

        self.last_timestamp = time.time()
        self.trajectory_points = []
        self.running = True

    def convert_inches(self, val_inches):
        if self.unit == 'in':
            return val_inches
        elif self.unit == 'ft':
            return val_inches / 12.0
        elif self.unit == 'm':
            return val_inches * 0.0254
        elif self.unit == 'yd':
            return val_inches / 36.0
        return val_inches / 12.0

    def process_raw_delta(self, dx_ticks, dy_ticks):
        if dx_ticks == 0 and dy_ticks == 0:
            return

        self.accumulated_x_ticks += dx_ticks
        self.accumulated_y_ticks += dy_ticks

        dx_in = dx_ticks / self.dpi
        dy_in = dy_ticks / self.dpi

        self.pos_x_inches += dx_in
        self.pos_y_inches += dy_in

        step_dist_in = math.sqrt(dx_in * dx_in + dy_in * dy_in)
        self.total_distance_inches += step_dist_in

        now = time.time()
        dt = now - self.last_timestamp
        speed_in_per_sec = (step_dist_in / dt) if dt > 0 else 0.0
        self.last_timestamp = now

        x_val = self.convert_inches(self.pos_x_inches)
        y_val = self.convert_inches(self.pos_y_inches)
        dist_val = self.convert_inches(self.total_distance_inches)
        speed_val = self.convert_inches(speed_in_per_sec)

        self.trajectory_points.append({
            "timestamp": round(now, 3),
            "x_inches": round(self.pos_x_inches, 4),
            "y_inches": round(self.pos_y_inches, 4),
            "dx_ticks": dx_ticks,
            "dy_ticks": dy_ticks
        })

        # Clear line and print live telemetry in CLI
        sys.stdout.write(
            f"\r[RAW MOUSE DRIVER] X: {x_val:8.2f} {self.unit} | "
            f"Y: {y_val:8.2f} {self.unit} | "
            f"Distance: {dist_val:8.2f} {self.unit} | "
            f"Speed: {speed_val:6.2f} {self.unit}/s | "
            f"DPI: {int(self.dpi)}"
        )
        sys.stdout.flush()

    def save_log(self):
        print("\n\n[DRIVER] Saving session trajectory log to:", self.log_file)
        data = {
            "dpi": self.dpi,
            "unit": self.unit,
            "total_distance_inches": round(self.total_distance_inches, 4),
            "total_distance_formatted": f"{self.convert_inches(self.total_distance_inches):.2f} {self.unit}",
            "point_count": len(self.trajectory_points),
            "points": self.trajectory_points
        }
        with open(self.log_file, "w") as f:
            json.dump(data, f, indent=2)
        print("[DRIVER] Trajectory saved successfully. Exiting.")


# --- Win32 Window & Message Loop ---
def run_driver_win32(dpi, unit, log_file):
    driver = RawMouseDriver(dpi=dpi, unit=unit, log_file=log_file)

    WNDPROC = WINFUNCTYPE(c_void_p, c_void_p, c_uint, c_void_p, c_void_p)

    def wnd_proc(hwnd, msg, wparam, lparam):
        if msg == WM_INPUT:
            dwSize = c_uint(0)
            GetRawInputData(lparam, RID_INPUT, None, byref(dwSize), sizeof(RAWINPUTHEADER))
            if dwSize.value > 0:
                raw_buffer = (c_char_p * dwSize.value)()
                if GetRawInputData(lparam, RID_INPUT, byref(raw_buffer), byref(dwSize), sizeof(RAWINPUTHEADER)) == dwSize.value:
                    raw_input = RAWINPUT_MOUSE.from_buffer(raw_buffer)
                    if raw_input.header.dwType == RIM_TYPEMOUSE:
                        dx = raw_input.mouse.lLastX
                        dy = raw_input.mouse.lLastY
                        driver.process_raw_delta(dx, dy)
            return 0
        elif msg in (WM_CLOSE, WM_DESTROY):
            user32.PostQuitMessage(0)
            return 0
        return DefWindowProc(hwnd, msg, wparam, lparam)

    wndProcDelegate = WNDPROC(wnd_proc)

    # Register Window Class
    class WNDCLASS(Structure):
        _fields_ = [
            ("style", c_uint),
            ("lpfnWndProc", WNDPROC),
            ("cbClsExtra", c_int),
            ("cbWndExtra", c_int),
            ("hInstance", c_void_p),
            ("hIcon", c_void_p),
            ("hCursor", c_void_p),
            ("hbrBackground", c_void_p),
            ("lpszMenuName", c_char_p),
            ("lpszClassName", c_char_p)
        ]

    wndClass = WNDCLASS()
    wndClass.lpszClassName = b"RawMouseDriverWindow"
    wndClass.lpfnWndProc = wndProcDelegate
    wndClass.hInstance = kernel32.GetModuleHandleW(None)

    user32.RegisterClassA(byref(wndClass))

    # Create Background Message Window
    hwnd = user32.CreateWindowExA(
        0, b"RawMouseDriverWindow", b"Raw Mouse Driver", 0, 0, 0, 0, 0, None, None, wndClass.hInstance, None
    )

    # Register Raw Input Mouse Device
    rid = RAWINPUTDEVICE()
    rid.usUsagePage = 0x01  # Generic Desktop Controls
    rid.usUsage = 0x02      # Mouse
    rid.dwFlags = RIDEV_INPUTSINK
    rid.hwndTarget = hwnd

    if not RegisterRawInputDevices(byref(rid), 1, sizeof(rid)):
        print("[ERROR] Failed to register Win32 Raw Input Mouse Device!")
        return

    print("==================================================================")
    print("      CONTINUOUS ROOM-SCALE MOUSE DRIVER (WIN32 RAW INPUT)       ")
    print("==================================================================")
    print(f" * Target DPI: {int(dpi)}")
    print(f" * Telemetry Unit: {unit}")
    print(f" * Screen Edge Limits: BYPASSED (Raw HID Packets)")
    print(f" * Log Output File: {log_file}")
    print("------------------------------------------------------------------")
    print(" Move your mouse around the room! Press Ctrl+C in terminal to stop.")
    print("------------------------------------------------------------------\n")

    class MSG(Structure):
        _fields_ = [
            ("hwnd", c_void_p),
            ("message", c_uint),
            ("wParam", c_void_p),
            ("lParam", c_void_p),
            ("time", c_ulong),
            ("pt_x", c_long),
            ("pt_y", c_long)
        ]

    msg = MSG()
    try:
        while user32.GetMessageW(byref(msg), 0, 0, 0) != 0:
            user32.TranslateMessage(byref(msg))
            user32.DispatchMessageW(byref(msg))
    except KeyboardInterrupt:
        pass
    finally:
        driver.save_log()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Raw Input Continuous Room-Scale Mouse Driver")
    parser.add_argument("--dpi", type=float, default=800, help="Mouse sensor hardware DPI (default: 800)")
    parser.add_argument("--unit", type=str, default="ft", choices=["ft", "in", "m", "yd"], help="Telemetry unit (default: ft)")
    parser.add_argument("--log", type=str, default="mouse_trajectory.json", help="Log output JSON file path")
    args = parser.parse_args()

    if sys.platform != "win32":
        print("[ERROR] This raw input driver uses Windows WM_INPUT API. Run on Windows OS.")
        sys.exit(1)

    run_driver_win32(args.dpi, args.unit, args.log)
