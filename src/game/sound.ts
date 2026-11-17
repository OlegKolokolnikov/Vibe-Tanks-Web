import { GameSettings, SettingsInfo } from "./settings";

type SoundName =
  | "shoot"
  | "explosion"
  | "intro"
  | "sad"
  | "game_over"
  | "victory"
  | "boss_defeated"
  | "player_death"
  | "base_destroyed"
  | "tree_burn"
  | "laser"
  | "powerup_spawn"
  | "explanation_music";

/** Relative volume of each sound (the actual volume is this times the master volume) */
const BASE_VOLUME: Record<SoundName, number> = {
  shoot: 0.4,
  explosion: 0.5,
  intro: 0.6,
  sad: 0.6,
  game_over: 0.6,
  victory: 0.6,
  boss_defeated: 0.7,
  player_death: 0.6,
  base_destroyed: 0.7,
  tree_burn: 0.5,
  laser: 0.4,
  powerup_spawn: 0.5,
  explanation_music: 0.3,
};

/** Sounds that can overlap (round-robin pool of this size) */
const POOL_SIZE: Partial<Record<SoundName, number>> = { shoot: 3, explosion: 3 };
const MIN_SOUND_INTERVAL = 0.05; // 50 ms between rapid sounds

/** Game sound effects and music on the Web Audio API */
class SoundManagerImpl {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private playing = new Map<SoundName, { source: AudioBufferSourceNode; gain: GainNode }[]>();
  private lastPlayTime = new Map<SoundName, number>();
  private music: AudioBufferSourceNode | null = null;
  private _isMuted = GameSettings.isMuted;
  private _volumeLevel = GameSettings.volumeLevel;

  /** Mute all sound. Saved to settings; silences sounds that are already playing. */
  get isMuted(): boolean {
    return this._isMuted;
  }
  set isMuted(value: boolean) {
    this._isMuted = value;
    GameSettings.isMuted = value;
    this.applyVolume();
  }

  /** Volume level 0...maxVolumeLevel. Saved to settings and applied immediately. */
  get volumeLevel(): number {
    return this._volumeLevel;
  }
  set volumeLevel(value: number) {
    this._volumeLevel = Math.min(Math.max(value, 0), SettingsInfo.maxVolumeLevel);
    GameSettings.volumeLevel = this._volumeLevel;
    this.applyVolume();
  }

  private get masterVolume(): number {
    return this._isMuted ? 0 : this._volumeLevel / SettingsInfo.maxVolumeLevel;
  }

  private get isSilent(): boolean {
    return this._isMuted || this._volumeLevel <= 0;
  }

  /** Browsers only allow audio after a user gesture: create / resume the context then */
  unlock(): void {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.applyVolume();
      void this.preload();
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  private async preload(): Promise<void> {
    const names = Object.keys(BASE_VOLUME) as SoundName[];
    await Promise.all(
      names.map(async (name) => {
        try {
          const response = await fetch(`sounds/${name}.wav`);
          const data = await response.arrayBuffer();
          this.buffers.set(name, await this.context!.decodeAudioData(data));
        } catch {
          // Missing or undecodable sound: play nothing for it
        }
      }),
    );
  }

  private applyVolume(): void {
    if (this.master && this.context) this.master.gain.setValueAtTime(this.masterVolume, this.context.currentTime);
  }

  private play(name: SoundName, loop = false): AudioBufferSourceNode | null {
    if (this.isSilent || !this.context || !this.master) return null;
    const buffer = this.buffers.get(name);
    if (!buffer) return null;

    const now = this.context.currentTime;
    const pool = POOL_SIZE[name];
    if (pool) {
      // Rate limit rapid fire sounds
      if (now - (this.lastPlayTime.get(name) ?? -1) < MIN_SOUND_INTERVAL) return null;
      this.lastPlayTime.set(name, now);
    }

    const active = this.playing.get(name) ?? [];
    // Single-instance sounds restart; pools drop the oldest once full
    while (active.length >= (pool ?? 1)) {
      const oldest = active.shift()!;
      try {
        oldest.source.stop();
      } catch {
        /* already stopped */
      }
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gain = this.context.createGain();
    gain.gain.value = BASE_VOLUME[name];
    source.connect(gain).connect(this.master);
    const entry = { source, gain };
    active.push(entry);
    this.playing.set(name, active);
    source.onended = () => {
      const list = this.playing.get(name);
      const index = list?.indexOf(entry) ?? -1;
      if (list && index >= 0) list.splice(index, 1);
    };
    source.start();
    return source;
  }

  private stop(name: SoundName): void {
    for (const entry of this.playing.get(name) ?? []) {
      try {
        entry.source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.playing.set(name, []);
  }

  // MARK: Sound effects

  playShoot(): void {
    this.play("shoot");
  }
  playExplosion(): void {
    this.play("explosion");
  }
  playIntro(): void {
    this.play("intro");
  }
  playSad(): void {
    this.play("sad");
  }
  playVictory(): void {
    this.play("victory");
  }
  playBossDefeated(): void {
    this.play("boss_defeated");
  }
  playPlayerDeath(): void {
    this.play("player_death");
  }
  playBaseDestroyed(): void {
    this.play("base_destroyed");
  }
  playTreeBurn(): void {
    this.play("tree_burn");
  }
  playLaser(): void {
    this.play("laser");
  }
  playPowerUpSpawn(): void {
    this.play("powerup_spawn");
  }
  playPowerUp(): void {
    this.playPowerUpSpawn();
  }

  /** 10-second game over tune (plays with the game over screen) */
  playGameOver(): void {
    this.play("game_over");
  }
  /** Cut the game over tune short (screen skipped, restart, menu) */
  stopGameOver(): void {
    this.stop("game_over");
  }

  // MARK: Music

  playBackgroundMusic(): void {
    this.stopBackgroundMusic();
    this.music = this.play("explanation_music", true);
  }

  stopBackgroundMusic(): void {
    this.stop("explanation_music");
    this.music = null;
  }

  get isMusicPlaying(): boolean {
    return this.music !== null;
  }

  stopGameplaySounds(): void {
    this.stop("shoot");
    this.stop("explosion");
  }
}

export const SoundManager = new SoundManagerImpl();
