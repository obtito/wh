// Small host-side state machine: late messages from a closed/replaced iframe
// can never uncover the active preview or complete a newer entrance.
export function acceptCinematicStatus(session, message, activeUrl) {
  if (!session || session.url !== activeUrl || message?.requestId !== session.requestId
    || !['preparing', 'running'].includes(session.phase)) return session;
  if (message.status === 'started') return session.phase === 'running' ? session : { ...session, phase: 'running' };
  if (['complete', 'skipped'].includes(message.status)) return { ...session, phase: 'complete', metrics: message.metrics ?? null };
  return session;
}

export function cinematicPoster(poster) {
  return poster?.replace(/\.png$/, '.webp');
}
