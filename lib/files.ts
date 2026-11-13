import * as FileSystem from 'expo-file-system/legacy';

const FACES_DIR = `${FileSystem.documentDirectory}faces/`;

/**
 * Move a cached face thumbnail into permanent app storage so it survives
 * cache eviction. Returns the new URI (or the original on failure).
 */
export async function persistFaceImage(uri: string | undefined, name: string): Promise<string | undefined> {
  if (!uri) return undefined;
  try {
    await FileSystem.makeDirectoryAsync(FACES_DIR, { intermediates: true });
    const dest = `${FACES_DIR}${name}-${Date.now().toString(36)}.jpg`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return uri;
  }
}

/** Best-effort delete of temporary files (e.g. unused live-scan thumbnails). */
export async function deleteFiles(uris: Iterable<string | undefined>) {
  await Promise.all(
    [...uris].filter(Boolean).map(uri =>
      FileSystem.deleteAsync(uri!, { idempotent: true }).catch(() => {})
    )
  );
}
