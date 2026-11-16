import { ByteReader, cstring, u32 } from '../protocol/bytes.js';
import { CMD } from '../protocol/commands.js';
import { Module } from './shared.js';

/** Configuration names: up to 11 ASCII characters (12 bytes with the terminating NUL). */
export const MAX_CONFIG_NAME = 11;

export interface ConfigInfo {
  version: number;
  images: number;
  layouts: number;
  fonts: number;
  pages: number;
  gauges: number;
}

export interface ConfigEntry {
  name: string;
  /** Size as reported (the docs say bytes; one example table says kB). */
  size: number;
  version: number;
  usageCount: number;
  installCount: number;
  isSystem: boolean;
}

export interface ConfigWriteOptions {
  /** Version number stored with the configuration. Default 1. */
  version?: number;
  /** Must match the password used when the configuration was created. Default 0. */
  password?: number;
}

/** Slow commands on a full memory: the docs recommend a 20 s timeout. */
const SLOW_TIMEOUT = 20_000;

function name(n: string): number[] {
  if (!n || n.length > MAX_CONFIG_NAME || !/^[\x20-\x7e]+$/.test(n)) {
    throw new RangeError(`Configuration name must be 1–${MAX_CONFIG_NAME} ASCII characters, got "${n}"`);
  }
  return cstring(n);
}

/**
 * Configurations hold everything stored on the glasses (images, layouts, fonts, pages,
 * gauges, animations). Saving any of these requires `write()` first, which opens (or
 * creates) the configuration that receives them.
 */
export class Configs extends Module {
  /** Opens or creates a configuration for writing (cfgWrite). Needs battery above 5 %. */
  write(configName: string, options: ConfigWriteOptions = {}): Promise<void> {
    return this.gl.send(CMD.cfgWrite, [...name(configName), ...u32(options.version ?? 1), ...u32(options.password ?? 0)]);
  }

  async read(configName: string): Promise<ConfigInfo> {
    const r = new ByteReader(await this.gl.query(CMD.cfgRead, name(configName)));
    return { version: r.u32(), images: r.u8(), layouts: r.u8(), fonts: r.u8(), pages: r.u8(), gauges: r.u8() };
  }

  /**
   * Makes a configuration the active one (cfgSet, "cfgSelect" in the docs).
   * Images, layouts and fonts belong to a configuration: cached sizes are dropped and the
   * fonts of the new configuration are read, so text is positioned with the right heights.
   */
  async select(configName: string): Promise<void> {
    await this.gl.send(CMD.cfgSet, name(configName));
    this.gl.images.forgetSizes();
    this.gl.layouts.forgetSizes();
    if (this.gl.readDeviceState) {
      try { await this.gl.fonts.list(); } catch { /* keep the previous heights */ }
    }
  }

  async list(): Promise<ConfigEntry[]> {
    const r = new ByteReader(await this.gl.query(CMD.cfgList, [], SLOW_TIMEOUT));
    const out: ConfigEntry[] = [];
    while (r.remaining >= 12) {
      out.push({
        name: r.cstring(),
        size: r.u32(),
        version: r.u32(),
        usageCount: r.u8(),
        installCount: r.u8(),
        isSystem: r.bool(),
      });
    }
    return out;
  }

  rename(oldName: string, newName: string, password = 0): Promise<void> {
    return this.gl.send(CMD.cfgRename, [...name(oldName), ...name(newName), ...u32(password)]);
  }

  delete(configName: string): Promise<void> {
    return this.gl.send(CMD.cfgDelete, name(configName));
  }

  /** Deletes the least used configuration. */
  deleteLeastUsed(): Promise<void> {
    return this.gl.send(CMD.cfgDeleteLessUsed);
  }

  /** Memory for configurations in bytes. */
  async freeSpace(): Promise<{ total: number; free: number }> {
    const r = new ByteReader(await this.gl.query(CMD.cfgFreeSpace));
    return { total: r.u32(), free: r.u32() };
  }

  async count(): Promise<number> {
    return new ByteReader(await this.gl.query(CMD.cfgGetNb)).u8();
  }
}
