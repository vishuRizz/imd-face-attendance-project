import { getSyncSnapshot } from '@/lib/database/db';

const SYNC_INTERVAL_MS = 60_000;

function getConfig() {
  const apiUrl = process.env.EXPO_PUBLIC_SYNC_API_URL?.replace(/\/$/, '');
  const token = process.env.EXPO_PUBLIC_SYNC_API_TOKEN;
  return apiUrl && token ? { apiUrl, token } : null;
}

export async function syncToCloud(): Promise<boolean> {
  const config = getConfig();
  if (!config) return false;

  try {
    const snapshot = await getSyncSnapshot();
    const response = await fetch(`${config.apiUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) throw new Error(`Sync request failed (${response.status})`);
    return true;
  } catch (error) {
    // The local database remains intact; the next foreground interval retries.
    console.warn('[Cloud sync] Deferred:', error);
    return false;
  }
}

/** Runs once on launch, then every minute while the app is active. */
export function startCloudSync() {
  void syncToCloud();
  const timer = setInterval(() => { void syncToCloud(); }, SYNC_INTERVAL_MS);
  return () => clearInterval(timer);
}
