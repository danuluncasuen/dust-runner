import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export type BuzzKind = 'sample' | 'nearMiss' | 'warn' | 'cell' | 'hit' | 'wreck';

// Native feel, softest first. 'selection' is the tiny tick iOS uses for pickers.
const NATIVE: Record<BuzzKind, 'selection' | ImpactStyle> = {
  sample: 'selection',
  nearMiss: 'selection',
  warn: 'selection',
  cell: ImpactStyle.Light,
  hit: ImpactStyle.Medium,
  wreck: ImpactStyle.Heavy,
};

// Web fallback in ms: the Vibration API works on Android, not in iOS Safari (it has none).
const WEB: Record<BuzzKind, number> = { sample: 5, nearMiss: 8, warn: 8, cell: 15, hit: 30, wreck: 50 };

// Back-to-back buzzes blur into a rattle, so drop any that come too soon after the last one.
const GAP_MS = 90;

const native = Capacitor.isNativePlatform();
// The selection generator has to be started once before it can tick.
if (native) Haptics.selectionStart().catch(() => {});
let last = -Infinity;

// Short haptic on game events: the Taptic Engine in the iOS app, vibration on the web.
export function buzz(kind: BuzzKind): void {
  const now = performance.now();
  if (kind !== 'wreck' && now - last < GAP_MS) return;
  last = now;
  if (native) {
    const style = NATIVE[kind];
    const done = style === 'selection' ? Haptics.selectionChanged() : Haptics.impact({ style });
    done.catch(() => {});
    return;
  }
  try {
    navigator.vibrate?.(WEB[kind]);
  } catch {
    // No vibration on this device.
  }
}
