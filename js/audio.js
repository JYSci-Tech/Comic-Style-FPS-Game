// Web Audio API 美式漫画风格合成音效引擎
export class ComicAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noiseBuffer = null;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this._createNoiseBuffer();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  _createNoiseBuffer() {
    const sr = this.ctx.sampleRate;
    const len = sr * 1.2;
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
  }

  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  _canPlay() {
    if (!this.enabled) return false;
    this.init();
    return !!this.ctx;
  }

  playMagnum() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.21);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(1500, t);
    filter.Q.value = 0.7;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.45, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + 0.17);
  }

  playShotgun() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(145, t);
    osc.frequency.exponentialRampToValueAtTime(26, t + 0.3);
    g.gain.setValueAtTime(0.62, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.34);

    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2600, t);
    filter.frequency.exponentialRampToValueAtTime(280, t + 0.32);
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.65, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + 0.35);

    this._clickAt(t + 0.34, 520, 0.08);
    this._clickAt(t + 0.45, 780, 0.09);
  }

  playRaygun() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc2.type = "square";
    osc.frequency.setValueAtTime(1250, t);
    osc.frequency.exponentialRampToValueAtTime(210, t + 0.12);
    osc2.frequency.setValueAtTime(1520, t);
    osc2.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc2.start(t);
    osc.stop(t + 0.14);
    osc2.stop(t + 0.14);
  }

  playEnemyShot() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(480, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.09);
    g.gain.setValueAtTime(0.11, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.11);
  }

  playPunch() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  playJump() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.11);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  playHit(isCrit = false) {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = isCrit ? "square" : "triangle";
    osc.frequency.setValueAtTime(isCrit ? 1420 : 880, t);
    osc.frequency.exponentialRampToValueAtTime(isCrit ? 720 : 420, t + 0.075);
    g.gain.setValueAtTime(isCrit ? 0.28 : 0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  playEnemyDown() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(340, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.24);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.27);
  }

  playExplosion() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1050, t);
    filter.frequency.exponentialRampToValueAtTime(75, t + 0.68);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.82, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.72);
    noise.connect(filter);
    filter.connect(g);
    g.connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + 0.74);
  }

  playReload() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    this._clickAt(t, 440, 0.1);
    this._clickAt(t + 0.18, 660, 0.12);
    this._clickAt(t + 0.34, 880, 0.14);
  }

  playDryFire() {
    if (!this._canPlay()) return;
    this._clickAt(this.ctx.currentTime, 300, 0.08);
  }

  playDash() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(520, t);
    filter.frequency.exponentialRampToValueAtTime(2400, t + 0.16);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    noise.connect(filter);
    filter.connect(g);
    g.connect(this.ctx.destination);
    noise.start(t);
    noise.stop(t + 0.19);
  }

  playPickup() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    [523, 659, 784].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(freq, t + idx * 0.055);
      g.gain.setValueAtTime(0.14, t + idx * 0.055);
      g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.055 + 0.1);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(t + idx * 0.055);
      osc.stop(t + idx * 0.055 + 0.11);
    });
  }

  playHurt() {
    if (!this._canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.linearRampToValueAtTime(58, t + 0.17);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.19);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  _clickAt(t, freq, vol) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.05);
  }
}
