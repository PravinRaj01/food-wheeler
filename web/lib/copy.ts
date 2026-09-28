/**
 * The Food Wheeler's voice: warm, a little cheeky, never cringe. The app
 * speaks as the couple's third wheel - the friend who steps in when
 * "anything's fine" has gone nowhere for the fifth minute running. Every
 * moment that needs this voice pulls its copy from here, with and without
 * names, so the tone stays consistent instead of drifting file by file.
 */

function nameOr(name: string, fallback: string): string {
  return name.trim() || fallback;
}

/** The deciding animation's source line - a one-line summary of what each
 * partner asked for, shown while the third wheel is "thinking". */
export function decidingIntro(p1Name: string, p2Name: string, p1Snippet: string, p2Snippet: string): string {
  const p1 = nameOr(p1Name, "Partner One");
  const p2 = nameOr(p2Name, "Partner Two");
  return `Let me think… ${p1} wants ${p1Snippet || "anything, apparently"}, ${p2} wants ${p2Snippet || "anything, apparently"}.`;
}

/** The reveal screen's kicker line, above the winning restaurant's name. */
export const REVEAL_KICKER = "Your third wheel picked";

/** The handoff screen, passing the phone from Partner One to Partner Two. */
export function handoffLine(p1Name: string, p2Name: string): string {
  const p1 = nameOr(p1Name, "");
  const p2 = nameOr(p2Name, "Partner Two");
  return p1 ? `Pass it to ${p2}. No peeking, ${p1}.` : `Pass it to ${p2}. No peeking.`;
}
