export const ORGANISER_IDLE_MS = 15 * 60_000;
export const ORGANISER_IDLE_WARNING_MS = 60_000;
export const ORGANISER_IDLE_STORAGE_KEY = 'naija-tickets-organiser-activity';

type ActivityRecord = {
  session: string;
  lastActivity: number;
  expired: boolean;
};

export type OrganiserIdleState = {
  status: 'active' | 'warning' | 'expired';
  secondsRemaining: number;
};

// This is a browser bookkeeping identifier, never an authentication decision.
// Session IDs stay stable across token refreshes and change on a new login.
export function organiserIdleIdentity(
  userId: string,
  accessToken: string,
  signedInAt: string,
) {
  try {
    const payload = accessToken.split('.')[1];
    const claims = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    ) as { session_id?: unknown };
    if (
      typeof claims.session_id === 'string' &&
      /^[a-f0-9-]{36}$/i.test(claims.session_id)
    )
      return `${userId}:${claims.session_id}`;
  } catch {
    // Older session formats still have a stable sign-in timestamp.
  }
  return `${userId}:${signedInAt}`;
}

type IdleOptions = {
  session: string;
  now: () => number;
  read: () => string | null;
  write: (value: string) => void;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
  onState: (state: OrganiserIdleState) => void;
  onExpire: () => void;
};

export function createOrganiserIdleSession(options: IdleOptions) {
  let lastActivity = options.now();
  let expired = false;
  let stopped = false;
  let timer: unknown;
  let previousState = '';

  function read() {
    try {
      const raw = options.read();
      if (!raw) return;
      const value = JSON.parse(raw) as Partial<ActivityRecord>;
      if (value.session !== options.session) return;
      if (
        typeof value.lastActivity !== 'number' ||
        !Number.isFinite(value.lastActivity) ||
        value.lastActivity < 0 ||
        typeof value.expired !== 'boolean'
      ) {
        expired = true;
        return;
      }
      lastActivity = Math.max(lastActivity, value.lastActivity);
      expired ||= value.expired;
    } catch {
      // Storage may be unavailable. The open tab still enforces its timer.
    }
  }

  function write() {
    try {
      options.write(
        JSON.stringify({ session: options.session, lastActivity, expired }),
      );
    } catch {
      // Private browsing/storage restrictions must not crash the portal.
    }
  }

  function publish(state: OrganiserIdleState) {
    const signature = `${state.status}:${state.secondsRemaining}`;
    if (signature !== previousState) {
      previousState = signature;
      options.onState(state);
    }
  }

  function expire() {
    if (stopped) return;
    stopped = true;
    expired = true;
    options.cancel(timer);
    write();
    publish({ status: 'expired', secondsRemaining: 0 });
    options.onExpire();
  }

  function check() {
    if (stopped) return;
    options.cancel(timer);
    read();
    const now = options.now();
    const remaining = ORGANISER_IDLE_MS - (now - lastActivity);
    if (expired || now < lastActivity || remaining <= 0) {
      expire();
      return;
    }
    const warning = remaining <= ORGANISER_IDLE_WARNING_MS;
    publish({
      status: warning ? 'warning' : 'active',
      secondsRemaining: warning ? Math.ceil(remaining / 1_000) : 0,
    });
    timer = options.schedule(
      check,
      warning
        ? Math.min(1_000, remaining)
        : remaining - ORGANISER_IDLE_WARNING_MS,
    );
  }

  // Restore before checking: reloading an idle portal must not start a new timer.
  try {
    const saved = options.read();
    if (saved) {
      const record = JSON.parse(saved) as Partial<ActivityRecord>;
      if (
        record.session === options.session &&
        typeof record.lastActivity === 'number'
      )
        lastActivity = record.lastActivity;
    }
  } catch {
    // Continue with an in-memory timer when storage is unavailable.
  }

  return {
    start() {
      check();
      if (!stopped) write();
    },
    activity(explicit = false) {
      check();
      if (stopped) return;
      const now = options.now();
      const warning =
        now - lastActivity >= ORGANISER_IDLE_MS - ORGANISER_IDLE_WARNING_MS;
      if (warning && !explicit) return;
      if (!explicit && now - lastActivity < 1_000) return;
      lastActivity = now;
      write();
      check();
    },
    check,
    expire,
    stop() {
      stopped = true;
      options.cancel(timer);
    },
  };
}
