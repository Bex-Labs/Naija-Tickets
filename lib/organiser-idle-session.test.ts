import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOrganiserIdleSession,
  organiserIdleIdentity,
  ORGANISER_IDLE_MS,
  type OrganiserIdleState,
} from './organiser-idle-session.ts';

function fixture(storage = { value: null as string | null }) {
  let now = 1_000_000;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const states: OrganiserIdleState[] = [];
  let expirations = 0;
  const options = {
    session: 'organiser:session-one',
    now: () => now,
    read: () => storage.value,
    write: (value: string) => {
      storage.value = value;
    },
    schedule(callback: () => void, delay: number) {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    cancel: (id: unknown) => {
      timers.delete(id as number);
    },
    onState: (state: OrganiserIdleState) => states.push(state),
    onExpire: () => {
      expirations += 1;
    },
  };
  const monitor = createOrganiserIdleSession(options);
  function advance(ms: number) {
    const until = now + ms;
    while (true) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = until;
  }
  return {
    monitor,
    options,
    storage,
    states,
    timers,
    advance,
    sleep: (ms: number) => {
      now += ms;
    },
    expired: () => expirations,
    latest: () => states.at(-1),
  };
}

void test('warns at fourteen minutes, locks at fifteen and expires only once', () => {
  const f = fixture();
  f.monitor.start();
  assert.equal(f.latest()?.status, 'active');
  f.advance(14 * 60_000);
  assert.deepEqual(f.latest(), { status: 'warning', secondsRemaining: 60 });
  f.advance(59_000);
  assert.equal(f.latest()?.secondsRemaining, 1);
  f.advance(1_000);
  assert.equal(f.latest()?.status, 'expired');
  assert.equal(f.expired(), 1);
  f.monitor.activity(true);
  f.monitor.check();
  f.advance(ORGANISER_IDLE_MS);
  assert.equal(f.expired(), 1);
  assert.equal(JSON.parse(f.storage.value!).expired, true);
});

void test('real activity renews the timer; focus checks and refresh checks do not', () => {
  const f = fixture();
  f.monitor.start();
  f.advance(10 * 60_000);
  f.monitor.activity();
  f.advance(10 * 60_000);
  assert.equal(f.latest()?.status, 'active');
  for (let i = 0; i < 5; i++) {
    f.advance(60_000);
    f.monitor.check();
  }
  assert.equal(f.expired(), 1);
});

void test('the warning requires an explicit stay-signed-in action', () => {
  const f = fixture();
  f.monitor.start();
  f.advance(14 * 60_000);
  f.monitor.activity();
  assert.equal(f.latest()?.status, 'warning');
  f.monitor.activity(true);
  assert.equal(f.latest()?.status, 'active');
  f.advance(14 * 60_000);
  assert.equal(f.expired(), 0);
  assert.equal(f.latest()?.status, 'warning');
});

void test('page reload preserves the deadline and expired sessions cannot reopen', () => {
  const f = fixture();
  f.monitor.start();
  f.advance(14 * 60_000);
  f.monitor.stop();
  const reloaded = createOrganiserIdleSession(f.options);
  reloaded.start();
  assert.equal(f.latest()?.secondsRemaining, 60);
  f.sleep(60_000);
  reloaded.check();
  assert.equal(f.expired(), 1);
  const reopened = createOrganiserIdleSession(f.options);
  reopened.start();
  assert.equal(f.latest()?.status, 'expired');
  assert.equal(f.expired(), 2);
});

void test('sleeping laptops and backgrounded tabs expire on resume without renewing', () => {
  const f = fixture();
  f.monitor.start();
  f.sleep(ORGANISER_IDLE_MS + 60_000);
  f.monitor.activity();
  assert.equal(f.expired(), 1);
  assert.equal(f.latest()?.status, 'expired');
});

void test('activity and logout are shared across organiser tabs', () => {
  const f = fixture();
  f.monitor.start();
  f.advance(10 * 60_000);
  let secondExpired = 0;
  const second = createOrganiserIdleSession({
    ...f.options,
    onExpire: () => {
      secondExpired++;
    },
  });
  second.start();
  f.advance(3 * 60_000);
  f.monitor.activity();
  f.advance(3 * 60_000);
  second.check();
  assert.equal(secondExpired, 0);
  f.monitor.expire();
  second.check();
  assert.equal(secondExpired, 1);
});

void test('a genuinely new login starts fresh, while closing a portal cleans its timers', () => {
  const f = fixture();
  f.monitor.start();
  f.monitor.expire();
  const fresh = createOrganiserIdleSession({
    ...f.options,
    session: 'organiser:session-two',
  });
  fresh.start();
  assert.equal(f.latest()?.status, 'active');
  fresh.stop();
  assert.equal(f.timers.size, 0);
});

void test('blocked browser storage still times out the open portal', () => {
  const f = fixture();
  const monitor = createOrganiserIdleSession({
    ...f.options,
    read: () => {
      throw Error('Storage blocked');
    },
    write: () => {
      throw Error('Storage blocked');
    },
  });
  monitor.start();
  f.advance(ORGANISER_IDLE_MS);
  assert.equal(f.expired(), 1);
});

void test('future activity timestamps and malformed matching records fail closed', () => {
  for (const record of [
    {
      session: 'organiser:session-one',
      lastActivity: 2_000_000,
      expired: false,
    },
    {
      session: 'organiser:session-one',
      lastActivity: 'invalid',
      expired: false,
    },
  ]) {
    const f = fixture({ value: JSON.stringify(record) });
    f.monitor.start();
    assert.equal(f.expired(), 1);
  }
});

void test('session bookkeeping survives JWT refresh without storing access tokens', () => {
  const token = (session: string, exp: number) =>
    `header.${Buffer.from(JSON.stringify({ session_id: session, exp })).toString('base64url')}.signature`;
  const first = token('00000000-0000-4000-8000-000000000001', 10);
  const refreshed = token('00000000-0000-4000-8000-000000000001', 20);
  const other = token('00000000-0000-4000-8000-000000000002', 20);
  assert.equal(
    organiserIdleIdentity('user', first, 'time'),
    organiserIdleIdentity('user', refreshed, 'time'),
  );
  assert.notEqual(
    organiserIdleIdentity('user', first, 'time'),
    organiserIdleIdentity('user', other, 'time'),
  );
  assert.equal(organiserIdleIdentity('user', 'invalid', 'time'), 'user:time');
  assert.ok(!organiserIdleIdentity('user', first, 'time').includes(first));
});
