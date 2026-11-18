// ---------------------------------------------------------------------------
// GRIDLOCK - Hybrid Audio & MIDI Synthesizer Engine
// BGM: background-1.m4a & background-2.m4a (ducked mix)
// Pickup SFX: pickup.wav (`kupljenje spike.WAV`)
// Movement & Victory: Precision Web Audio MIDI Synth with Orb Velocity Intensity
// ---------------------------------------------------------------------------

import bgm1Url from './assets/audio/background-1.m4a';
import bgm2Url from './assets/audio/background-2.m4a';
import pickupSfxUrl from './assets/audio/pickup.wav';

export type AudioGameMode = 'standard' | 'challenge' | 'overclock' | 'blitz' | string;

const BGM_TRACKS = [bgm1Url, bgm2Url];

// Base gain ceiling for background music so it sits warmly under gameplay
const BGM_MAX_GAIN = 0.24;

// A-minor pentatonic MIDI notes for dynamic orb movement scaling (A3 -> A5)
const ORB_MOVE_MIDI_SCALE = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81];

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  public enabled = true;         // SFX enabled
  public musicEnabled = true;    // Background music enabled
  public musicVolume = 0.55;     // 0.0 - 1.0
  public sfxVolume = 0.75;       // 0.0 - 1.0

  // Web Audio Routing
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private bgmDuckGain: GainNode | null = null;

  // Decoded Pickup WAV Buffer
  private pickupBuffer: AudioBuffer | null = null;
  private sfxLoadingStarted = false;

  // Orb Movement Intensity State
  private lastMoveTimeMs = 0;
  private moveCombo = 0;

  // BGM HTMLAudio + MediaElementSource
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmSourceConnected = false;
  private currentTrackIdx = Math.floor(Math.random() * BGM_TRACKS.length);
  private isBgmPlaying = false;
  private unlockBound = false;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const storedSfx = localStorage.getItem('gridlock_sound_enabled');
        if (storedSfx !== null) this.enabled = storedSfx === 'true';

        const storedMusic = localStorage.getItem('gridlock_music_enabled');
        if (storedMusic !== null) this.musicEnabled = storedMusic === 'true';

        const storedMusicVol = localStorage.getItem('gridlock_music_volume');
        if (storedMusicVol !== null) {
          const parsed = parseFloat(storedMusicVol);
          if (!isNaN(parsed)) this.musicVolume = Math.max(0, Math.min(1, parsed));
        }
      } catch {
        // localStorage may be restricted in sandbox
      }

      this.bindAutoplayUnlock();

      // Attempt immediate playback in case host allows autoplay from Splash Play click
      if (this.musicEnabled) {
        setTimeout(() => {
          if (this.musicEnabled && !this.isBgmPlaying) {
            this.startBgm();
          }
        }, 60);
      }
    }
  }

  private bindAutoplayUnlock() {
    if (typeof window === 'undefined' || this.unlockBound) return;
    this.unlockBound = true;

    const unlockAudio = () => {
      const ctx = this.initContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      if (this.musicEnabled && !this.isBgmPlaying) {
        this.startBgm(() => {
          window.removeEventListener('pointerdown', unlockAudio);
          window.removeEventListener('keydown', unlockAudio);
          window.removeEventListener('touchstart', unlockAudio);
          this.unlockBound = false;
        });
      } else if (!this.musicEnabled) {
        window.removeEventListener('pointerdown', unlockAudio);
        window.removeEventListener('keydown', unlockAudio);
        window.removeEventListener('touchstart', unlockAudio);
        this.unlockBound = false;
      }
    };

    window.addEventListener('pointerdown', unlockAudio, { passive: true });
    window.addEventListener('keydown', unlockAudio, { passive: true });
    window.addEventListener('touchstart', unlockAudio, { passive: true });
  }

  private initContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();

        // Master output
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);

        // SFX bus
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.setValueAtTime(this.enabled ? this.sfxVolume : 0.0001, this.ctx.currentTime);
        this.sfxGain.connect(this.masterGain);

        // BGM ducking bus -> BGM volume bus -> Master
        this.bgmGain = this.ctx.createGain();
        this.bgmGain.gain.setValueAtTime(this.getTargetBgmGain(), this.ctx.currentTime);
        this.bgmGain.connect(this.masterGain);

        this.bgmDuckGain = this.ctx.createGain();
        this.bgmDuckGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
        this.bgmDuckGain.connect(this.bgmGain);

        // Preload pickup WAV buffer
        void this.preloadPickupBuffer();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getTargetBgmGain(): number {
    return this.musicEnabled ? this.musicVolume * BGM_MAX_GAIN : 0.0001;
  }

  private async preloadPickupBuffer(): Promise<void> {
    if (this.sfxLoadingStarted || !this.ctx) return;
    this.sfxLoadingStarted = true;

    try {
      const res = await fetch(pickupSfxUrl);
      if (!res.ok) return;
      const arrayBuf = await res.arrayBuffer();
      if (!this.ctx) return;
      this.pickupBuffer = await this.ctx.decodeAudioData(arrayBuf);
    } catch {
      // Fallback handled gracefully if decode fails
    }
  }

  /**
   * Temporarily lowers BGM slightly so important SFX cut cleanly through the mix
   */
  private duckBgm(duckRatio: number, holdSec: number, releaseSec: number) {
    if (!this.ctx || !this.bgmDuckGain || !this.isBgmPlaying) return;
    try {
      const now = this.ctx.currentTime;
      this.bgmDuckGain.gain.cancelScheduledValues(now);
      this.bgmDuckGain.gain.setValueAtTime(this.bgmDuckGain.gain.value, now);
      this.bgmDuckGain.gain.linearRampToValueAtTime(duckRatio, now + 0.05);
      this.bgmDuckGain.gain.setValueAtTime(duckRatio, now + 0.05 + holdSec);
      this.bgmDuckGain.gain.linearRampToValueAtTime(1.0, now + 0.05 + holdSec + releaseSec);
    } catch {}
  }

  /**
   * Plays a clean MIDI Synth voice with velocity-reactive filter cutoff & envelope
   */
  private playMidiVoice(
    midiNote: number,
    durationSec: number,
    velocity: number,
    wave: OscillatorType = 'triangle',
    cutoffHz = 1800,
    delaySec = 0
  ) {
    const ctx = this.initContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const startTime = ctx.currentTime + delaySec;
      const freq = midiToFreq(midiNote);

      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      osc.type = wave;
      osc.frequency.setValueAtTime(freq, startTime);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoffHz, startTime);
      filter.frequency.exponentialRampToValueAtTime(Math.max(240, cutoffHz * 0.35), startTime + durationSec);
      filter.Q.setValueAtTime(1.8, startTime);

      const peakGain = Math.max(0.005, Math.min(0.14, velocity)) * this.sfxVolume;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);

      osc.start(startTime);
      osc.stop(startTime + durationSec + 0.02);
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // SFX Methods (MIDI Synth for Movement & Victory, WAV sample for Pickup)
  // ---------------------------------------------------------------------------

  /**
   * MIDI Orb Movement with Dynamic Movement Intensity:
   * - Slow single step -> soft, warm low MIDI pluck
   * - Fast consecutive drag/combo -> climbs A-minor pentatonic MIDI scale,
   *   opens filter brightness, increases velocity, and adds harmonic overtones.
   */
  step(isTurn: boolean, elevationDelta: number = 0) {
    if (!this.enabled) return;

    const nowMs = performance.now();
    const deltaMs = this.lastMoveTimeMs > 0 ? nowMs - this.lastMoveTimeMs : 1000;
    if (deltaMs < 35) return; // Prevent duplicate sub-frame spam
    this.lastMoveTimeMs = nowMs;

    // Update movement combo & velocity intensity (0.0 -> 1.0)
    if (deltaMs < 650) {
      this.moveCombo = Math.min(ORB_MOVE_MIDI_SCALE.length - 1, this.moveCombo + 1);
    } else {
      this.moveCombo = 0;
    }

    const speedFactor = deltaMs < 650 ? Math.max(0, Math.min(1, 1 - deltaMs / 650)) : 0.15;
    const intensity = Math.min(1, 0.2 + this.moveCombo * 0.065 + speedFactor * 0.35);

    // Base MIDI note climbs the A-minor pentatonic scale as movement intensity rises
    let midiNote = ORB_MOVE_MIDI_SCALE[this.moveCombo];
    if (elevationDelta > 0) midiNote += 2;
    else if (elevationDelta < 0) midiNote -= 2;

    // Filter brightness and volume scale with orb movement intensity
    const cutoffHz = 750 + intensity * 2600;
    const velocity = 0.038 + intensity * 0.055;
    const duration = 0.075 + intensity * 0.045;

    this.playMidiVoice(midiNote, duration, velocity, isTurn ? 'sawtooth' : 'triangle', cutoffHz);

    // At turns or high movement intensity, add a crisp harmonic fifth/octave MIDI shimmer
    if (isTurn || intensity > 0.55) {
      const harmonicInterval = isTurn ? 7 : 12; // Perfect 5th on turn, Octave on high speed
      this.playMidiVoice(
        midiNote + harmonicInterval,
        duration * 0.85,
        velocity * 0.45,
        'sine',
        cutoffHz * 1.2,
        0.012
      );
    }
  }

  /**
   * Spike / Node pickup (`kupljenje spike.WAV`) with progressive pitch rise & light BGM duck
   */
  collectNode(count: number) {
    if (!this.enabled) return;
    const rate = 1.0 + Math.min(0.16, Math.max(0, count - 1) * 0.035);
    this.duckBgm(0.68, 0.25, 0.4);

    const ctx = this.initContext();
    if (ctx && this.sfxGain && this.pickupBuffer) {
      try {
        const now = ctx.currentTime;
        const source = ctx.createBufferSource();
        const gainNode = ctx.createGain();
        source.buffer = this.pickupBuffer;
        source.playbackRate.setValueAtTime(rate, now);
        gainNode.gain.setValueAtTime(0.68 * this.sfxVolume, now);
        source.connect(gainNode);
        gainNode.connect(this.sfxGain);
        source.start(now);
        return;
      } catch {}
    }

    // MIDI fallback if buffer hasn't finished decoding
    this.playMidiVoice(69 + Math.min(12, (count - 1) * 2), 0.2, 0.07, 'triangle', 2400);
  }

  /**
   * Level Complete - Pure MIDI Poly-Synth Victory Fanfare (Am -> G -> F -> A major)
   */
  win() {
    if (!this.enabled) return;
    this.moveCombo = 0;
    this.duckBgm(0.48, 1.2, 0.9);

    // 1. Deep MIDI bass root progression (A2 -> G2 -> F2 -> A2)
    this.playMidiVoice(45, 0.22, 0.07, 'triangle', 600, 0.0);
    this.playMidiVoice(43, 0.22, 0.07, 'triangle', 600, 0.11);
    this.playMidiVoice(41, 0.22, 0.07, 'triangle', 600, 0.22);
    this.playMidiVoice(45, 0.65, 0.085, 'triangle', 800, 0.34);

    // 2. Triumphant MIDI Poly-Synth Chords (Am -> G -> F -> A major resolution)
    const chords: Array<{ notes: number[]; delay: number; dur: number }> = [
      { notes: [57, 60, 64], delay: 0.0, dur: 0.16 },          // Am (A3, C4, E4)
      { notes: [55, 59, 62], delay: 0.11, dur: 0.16 },         // G  (G3, B3, D4)
      { notes: [53, 57, 60], delay: 0.22, dur: 0.16 },         // F  (F3, A3, C4)
      { notes: [57, 61, 64, 69, 73], delay: 0.34, dur: 0.75 }, // A major! (A3, C#4, E4, A4, C#5)
    ];

    chords.forEach(({ notes, delay, dur }) => {
      notes.forEach((n, idx) => {
        this.playMidiVoice(
          n,
          dur,
          0.045 + idx * 0.008,
          idx === notes.length - 1 ? 'sawtooth' : 'triangle',
          2400,
          delay
        );
      });
    });

    // 3. Ascending MIDI sparkle arpeggio (A4 -> C#5 -> E5 -> A5)
    [69, 73, 76, 81].forEach((n, i) => {
      this.playMidiVoice(n, 0.28, 0.045, 'sine', 3600, 0.36 + i * 0.055);
    });
  }

  /**
   * Subtle MIDI pre-win ping when touching the exit portal
   */
  reachExit() {
    if (!this.enabled) return;
    this.playMidiVoice(69, 0.14, 0.05, 'sine', 2200, 0);
    this.playMidiVoice(76, 0.18, 0.045, 'triangle', 2600, 0.04);
  }

  undo() {
    if (!this.enabled) return;
    this.moveCombo = Math.max(0, this.moveCombo - 1);
    this.playMidiVoice(52, 0.08, 0.045, 'sine', 900);
  }

  hint() {
    if (!this.enabled) return;
    this.playMidiVoice(73, 0.14, 0.05, 'triangle', 2200, 0);
    this.playMidiVoice(81, 0.2, 0.045, 'sine', 2800, 0.05);
  }

  outOfMoves() {
    if (!this.enabled) return;
    this.moveCombo = 0;
    this.playMidiVoice(45, 0.14, 0.055, 'sawtooth', 700, 0);
    this.playMidiVoice(40, 0.18, 0.05, 'triangle', 550, 0.07);
  }

  // ---------------------------------------------------------------------------
  // Background Music Playback (`background-1.mp3` <-> `background-2.mp3`)
  // ---------------------------------------------------------------------------

  private pickNextShuffledTrack(): number {
    if (BGM_TRACKS.length <= 1) return 0;
    let next = Math.floor(Math.random() * BGM_TRACKS.length);
    if (next === this.currentTrackIdx) {
      next = (this.currentTrackIdx + 1 + Math.floor(Math.random() * (BGM_TRACKS.length - 1))) % BGM_TRACKS.length;
    }
    return next;
  }

  private ensureBgmElement(): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    if (!this.bgmAudio) {
      const audio = new Audio(BGM_TRACKS[this.currentTrackIdx]);
      audio.preload = 'auto';
      audio.loop = false;

      // Shuffle to a different track when the current track finishes
      audio.addEventListener('ended', () => {
        if (!this.musicEnabled || !this.isBgmPlaying) return;
        this.currentTrackIdx = this.pickNextShuffledTrack();
        audio.src = BGM_TRACKS[this.currentTrackIdx];
        audio.play().catch(() => {});
      });

      this.bgmAudio = audio;
    }

    const ctx = this.initContext();
    if (ctx && this.bgmDuckGain && !this.bgmSourceConnected) {
      try {
        const source = ctx.createMediaElementSource(this.bgmAudio);
        source.connect(this.bgmDuckGain);
        this.bgmSourceConnected = true;
      } catch {
        this.bgmAudio.volume = this.getTargetBgmGain();
      }
    }

    return this.bgmAudio;
  }

  public startBgm(onStarted?: () => void) {
    if (!this.musicEnabled || this.isBgmPlaying) return;
    const ctx = this.initContext();
    const audio = this.ensureBgmElement();
    if (!audio) return;

    this.isBgmPlaying = true;

    if (ctx && this.bgmGain && this.bgmSourceConnected) {
      const now = ctx.currentTime;
      this.bgmGain.gain.cancelScheduledValues(now);
      this.bgmGain.gain.setValueAtTime(0.0001, now);
      this.bgmGain.gain.linearRampToValueAtTime(this.getTargetBgmGain(), now + 1.4);
    } else {
      audio.volume = this.getTargetBgmGain();
    }

    audio
      .play()
      .then(() => {
        onStarted?.();
      })
      .catch(() => {
        this.isBgmPlaying = false;
      });
  }

  public stopBgm() {
    if (!this.isBgmPlaying && !this.bgmAudio) return;
    this.isBgmPlaying = false;

    if (this.ctx && this.bgmGain && this.bgmSourceConnected) {
      const now = this.ctx.currentTime;
      this.bgmGain.gain.cancelScheduledValues(now);
      this.bgmGain.gain.linearRampToValueAtTime(0.0001, now + 0.35);
      setTimeout(() => {
        if (!this.isBgmPlaying && this.bgmAudio) {
          this.bgmAudio.pause();
        }
      }, 380);
    } else if (this.bgmAudio) {
      this.bgmAudio.pause();
    }
  }

  // ---------------------------------------------------------------------------
  // Reactive & User Controls
  // ---------------------------------------------------------------------------

  public setGameState(_mode: AudioGameMode, _intensity: number) {
    // Reset movement combo when level resets or nodes change
    if (_intensity === 0) {
      this.moveCombo = 0;
    }
  }

  public setSfxEnabled(val: boolean) {
    this.enabled = val;
    try {
      localStorage.setItem('gridlock_sound_enabled', String(val));
    } catch {}

    if (this.sfxGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.sfxGain.gain.cancelScheduledValues(now);
      this.sfxGain.gain.setValueAtTime(val ? this.sfxVolume : 0.0001, now);
    }
  }

  public setMusicEnabled(val: boolean) {
    this.musicEnabled = val;
    try {
      localStorage.setItem('gridlock_music_enabled', String(val));
    } catch {}

    if (val) {
      this.startBgm();
    } else {
      this.stopBgm();
    }
  }

  public setMusicVolume(val: number) {
    this.musicVolume = Math.max(0, Math.min(1, val));
    try {
      localStorage.setItem('gridlock_music_volume', String(this.musicVolume));
    } catch {}

    const target = this.getTargetBgmGain();
    if (this.bgmGain && this.ctx && this.bgmSourceConnected) {
      const now = this.ctx.currentTime;
      this.bgmGain.gain.cancelScheduledValues(now);
      this.bgmGain.gain.linearRampToValueAtTime(target, now + 0.1);
    } else if (this.bgmAudio) {
      this.bgmAudio.volume = target;
    }
  }
}

export const sound = new SoundEngine();
