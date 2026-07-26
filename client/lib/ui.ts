/** Shared control styling. Lives here rather than in Board.tsx so the board,
 *  the how-to-play dialog and the homepage all render the same vocabulary. */

export const BTN_FOCUS =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:ring-white';

/** Disabled controls drop the white label and let the slate outline fade out,
 *  rather than dimming the whole button with opacity alone — at opacity-50 a
 *  thin slate outline on black stayed close enough to the enabled state to be
 *  misread. Disabled controls are exempt from the WCAG contrast minimums, so
 *  the low ratio here is the signal, not a regression. */
export const BTN_DISABLED =
  'disabled:cursor-not-allowed disabled:border-sk-slate/25 disabled:bg-transparent disabled:text-sk-slate/60';

export const BTN_SECONDARY = `rounded border border-sk-slate px-3 py-1.5 text-sm text-white transition enabled:hover:bg-sk-slate/15 ${BTN_FOCUS} ${BTN_DISABLED}`;

/** The primary action's emphasis is carried by the white fill (black-on-white,
 *  21:1); sk-red is only the frame around it. */
export const BTN_PRIMARY = `rounded border-2 border-sk-red bg-white px-4 py-1.5 text-sm font-bold text-black transition enabled:hover:bg-white/85 ${BTN_FOCUS} ${BTN_DISABLED}`;

// Navigation actions are links, not buttons: they navigate, and being copyable
// / openable in a new tab matters when both seats have to reach the same URL.
export const LINK_PRIMARY = `inline-block rounded border-2 border-sk-red bg-white px-5 py-2 text-sm font-bold text-black transition hover:bg-white/85 ${BTN_FOCUS}`;
export const LINK_SECONDARY = `inline-block rounded border border-sk-slate px-5 py-2 text-sm text-white transition hover:bg-sk-slate/15 ${BTN_FOCUS}`;

/** Small uppercase section label. */
export const EYEBROW = 'text-[10px] uppercase tracking-[0.15em] text-sk-slate';
