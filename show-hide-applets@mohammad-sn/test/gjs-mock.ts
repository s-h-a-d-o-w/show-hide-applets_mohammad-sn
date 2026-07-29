import { beforeEach, vi } from "vitest";

// A tiny virtual filesystem so `Gio.File`/`GdkPixbuf` interactions in icons.ts
// can be exercised without touching the real disk.
export const vfs = new Set<string>();

export const mkdirCalls: string[] = [];
export const copyCalls: { from: string; to: string }[] = [];
export const searchPaths: string[] = [];
export const pixbufSavev = vi.fn();
export const logError = vi.fn();

class MockGioFile {
  path: string;

  constructor(path: string) {
    this.path = path;
  }

  query_exists() {
    return vfs.has(this.path);
  }

  make_directory_with_parents() {
    mkdirCalls.push(this.path);
    vfs.add(this.path);
    return true;
  }

  get_path() {
    return this.path;
  }

  get_child(name: string) {
    return new MockGioFile(this.path + "/" + name);
  }

  copy(dest: MockGioFile) {
    copyCalls.push({ from: this.path, to: dest.path });
    vfs.add(dest.path);
    return true;
  }
}

// Records both label/state args and any connected signal handlers so tests can
// assert construction and simulate a "toggled" user interaction.
export class MockPopupSwitchMenuItem {
  handlers: Record<string, (() => void)[]> = {};
  label: string;
  state: boolean;

  constructor(label: string, state: boolean) {
    this.label = label;
    this.state = state;
  }

  connect(signal: string, cb: () => void) {
    (this.handlers[signal] ??= []).push(cb);
    return 1;
  }

  emit(signal: string) {
    this.handlers[signal]?.forEach((cb) => cb());
  }
}

export class MockPopupSwitchIconMenuItem extends MockPopupSwitchMenuItem {
  iconName: string;
  iconType: string;

  constructor(
    label: string,
    state: boolean,
    iconName: string,
    iconType: string,
  ) {
    super(label, state);
    this.iconName = iconName;
    this.iconType = iconType;
  }
}

export function resetGjsMock() {
  vfs.clear();
  mkdirCalls.length = 0;
  copyCalls.length = 0;
  searchPaths.length = 0;
  pixbufSavev.mockClear();
  logError.mockClear();
}

const importsMock = {
  gi: {
    St: { IconType: { FULLCOLOR: "FULLCOLOR", SYMBOLIC: "SYMBOLIC" } },
    Gtk: {
      IconTheme: {
        get_default: () => ({
          append_search_path: (p: string) => searchPaths.push(p),
        }),
      },
    },
    Gio: {
      File: { new_for_path: (p: string) => new MockGioFile(p) },
      FileCopyFlags: { NONE: 0 },
    },
    GdkPixbuf: {
      Pixbuf: { new_from_file: () => ({ savev: pixbufSavev }) },
    },
  },
  ui: {
    popupMenu: {
      PopupSwitchMenuItem: MockPopupSwitchMenuItem,
      PopupSwitchIconMenuItem: MockPopupSwitchIconMenuItem,
    },
  },
};

(globalThis as any).imports = importsMock;
(globalThis as any).global ??= {};
(globalThis as any).global.logError = logError;

beforeEach(resetGjsMock);
