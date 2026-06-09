// sensors.js — Input controller for Tilt Tiles
// Provides a normalized tilt vector {ax, ay} in range [-1, 1].
//   ax > 0  -> tilt right,  ax < 0 -> tilt left
//   ay > 0  -> tilt down (toward you), ay < 0 -> tilt up (away)
// Falls back to keyboard (arrows / WASD) on desktop or when sensors are unavailable.

export class InputController {
  constructor() {
    this.mode = 'keyboard';        // 'sensor' | 'keyboard'
    this.enabled = false;

    // Sensor state
    this._beta = 0;                // front-back tilt (deg)
    this._gamma = 0;               // left-right tilt (deg)
    this._calBeta = null;          // calibration offset captured on enable
    this._calGamma = null;
    this._haveSensorData = false;

    // Keyboard state
    this._keys = { up: false, down: false, left: false, right: false };

    // Tuning
    this.maxTilt = 35;             // degrees of tilt that maps to full input

    this._onOrient = this._onOrient.bind(this);
    this._attachKeyboard();
  }

  // True if this platform requires an explicit permission prompt (iOS 13+).
  static needsPermission() {
    return typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  static sensorsSupported() {
    return typeof DeviceOrientationEvent !== 'undefined';
  }

  // Must be called from a user gesture (e.g., button click) for iOS.
  async enableSensors() {
    if (!InputController.sensorsSupported()) {
      this.mode = 'keyboard';
      this.enabled = true;
      return { mode: 'keyboard', reason: 'no-sensor' };
    }

    try {
      if (InputController.needsPermission()) {
        const res = await DeviceOrientationEvent.requestPermission();
        if (res !== 'granted') {
          this.mode = 'keyboard';
          this.enabled = true;
          return { mode: 'keyboard', reason: 'denied' };
        }
      }
      window.addEventListener('deviceorientation', this._onOrient, true);
      this.mode = 'sensor';
      this.enabled = true;
      // Recalibrate on next reading.
      this._calBeta = null;
      this._calGamma = null;
      return { mode: 'sensor' };
    } catch (e) {
      this.mode = 'keyboard';
      this.enabled = true;
      return { mode: 'keyboard', reason: 'error' };
    }
  }

  // Enable keyboard-only (desktop) without requesting sensors.
  enableKeyboard() {
    this.mode = 'keyboard';
    this.enabled = true;
  }

  // Re-zero the neutral position to the current orientation.
  recalibrate() {
    this._calBeta = null;
    this._calGamma = null;
  }

  _onOrient(e) {
    if (e.beta == null || e.gamma == null) return;
    this._haveSensorData = true;
    this._beta = e.beta;
    this._gamma = e.gamma;
    if (this._calBeta === null) {
      this._calBeta = e.beta;
      this._calGamma = e.gamma;
    }
  }

  _attachKeyboard() {
    const set = (code, val) => {
      switch (code) {
        case 'ArrowUp': case 'KeyW': this._keys.up = val; break;
        case 'ArrowDown': case 'KeyS': this._keys.down = val; break;
        case 'ArrowLeft': case 'KeyA': this._keys.left = val; break;
        case 'ArrowRight': case 'KeyD': this._keys.right = val; break;
      }
    };
    window.addEventListener('keydown', (e) => set(e.code, true));
    window.addEventListener('keyup', (e) => set(e.code, false));
  }

  // Returns normalized input {ax, ay} in [-1, 1].
  get() {
    if (this.mode === 'sensor' && this._haveSensorData && this._calBeta !== null) {
      const dGamma = this._gamma - this._calGamma; // left-right
      const dBeta = this._beta - this._calBeta;     // front-back
      const ax = clamp(dGamma / this.maxTilt, -1, 1);
      const ay = clamp(dBeta / this.maxTilt, -1, 1);
      return { ax, ay };
    }
    // Keyboard
    let ax = 0, ay = 0;
    if (this._keys.left) ax -= 1;
    if (this._keys.right) ax += 1;
    if (this._keys.up) ay -= 1;
    if (this._keys.down) ay += 1;
    return { ax, ay };
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
