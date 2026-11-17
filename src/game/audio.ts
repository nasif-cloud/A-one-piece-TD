/**
 * Lightweight procedural Web Audio synthesizer for crisp retro sound effects.
 * Uses zero external audio files and respects the mute toggle.
 */

class RetroAudio {
  private ctx: AudioContext | null = null;
  private muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    durationSec: number,
    type: OscillatorType,
    volume: number,
    delaySec = 0
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delaySec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + durationSec);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  }

  public playPlace(): void {
    this.playTone(240, 420, 0.08, 'square', 0.08);
  }

  public playShoot(): void {
    this.playTone(520, 260, 0.05, 'triangle', 0.05);
  }

  public playPop(): void {
    this.playTone(680, 190, 0.07, 'sine', 0.11);
  }

  public playHeal(): void {
    this.playTone(440, 660, 0.09, 'sine', 0.05);
  }

  public playWaveStart(): void {
    this.playTone(330, 440, 0.09, 'square', 0.07, 0);
    this.playTone(440, 660, 0.12, 'square', 0.07, 0.09);
  }

  public playLeak(): void {
    this.playTone(170, 95, 0.16, 'sawtooth', 0.09);
  }

  public playVictory(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.playTone(n, n * 1.02, 0.14, 'square', 0.07, i * 0.09);
    });
  }

  public playGameOver(): void {
    const notes = [349.23, 293.66, 220.0];
    notes.forEach((n, i) => {
      this.playTone(n, n * 0.94, 0.18, 'sawtooth', 0.07, i * 0.14);
    });
  }
}

export const retroAudio = new RetroAudio();
