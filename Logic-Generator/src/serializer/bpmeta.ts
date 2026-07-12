// .bpmeta writer — a plain UTF-8 JSON sidecar.
//   {"_name":"...","_folder":"...","_version":"0.1.139"}

export const BLUEPRINT_GAME_VERSION = "0.1.139";

export interface BpMeta {
  name: string;
  folder: string;
  version?: string;
}

export function buildBpMeta(meta: BpMeta): Uint8Array {
  const json = JSON.stringify({
    _name: meta.name,
    _folder: meta.folder,
    _version: meta.version ?? BLUEPRINT_GAME_VERSION,
  });
  return new TextEncoder().encode(json);
}
