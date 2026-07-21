// URL flags. `?flag` or `#flag` — the hash form also works from file:// static
// builds. Main thread only: a worker's `location` is its own script URL.

const flag = (name: string) =>
  new RegExp(`(^|[?&#])${name}(&|=|$)`).test(location.search + location.hash);

export const DEBUG = flag("debug");

/** Enable the blocks the game's demo build doesn't ship. */
export const ALL_BLOCKS = flag("allblocks");
