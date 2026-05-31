const SAMPLING_RATE_MIN = 0;
const SAMPLING_RATE_MAX = 1;

export function parseSamplingRate(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < SAMPLING_RATE_MIN || parsed > SAMPLING_RATE_MAX) {
    return fallback;
  }

  return parsed;
}
