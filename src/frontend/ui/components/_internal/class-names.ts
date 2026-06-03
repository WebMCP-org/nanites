/**
 * Concatenates class-name parts, skipping falsy values.
 *
 * Matches the idiom used throughout existing components:
 * `[...].filter(Boolean).join(" ")`
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
