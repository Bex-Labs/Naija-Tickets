import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorisedAttendeeList,
  literalSearchPattern,
  parseAttendeeQuery,
} from './organiser-attendees.ts';

const eventId = '12345678-1234-1234-1234-123456789abc';
void test('anonymous and unrelated users cannot trigger attendee reads', async () => {
  let reads = 0;
  let checks = 0;
  const source = {
    canView: async () => {
      checks++;
      return false;
    },
    list: async () => {
      reads++;
      return [];
    },
  };
  assert.equal(
    (await authorisedAttendeeList(null, eventId, source)).status,
    401,
  );
  assert.equal(checks, 0);
  assert.equal(
    (await authorisedAttendeeList('unrelated', eventId, source)).status,
    404,
  );
  assert.equal(reads, 0);
});
void test('membership check receives requested event and authenticated user before reading', async () => {
  const calls: string[] = [];
  const result = await authorisedAttendeeList('owner', eventId, {
    canView: async (user, event) => {
      assert.equal(user, 'owner');
      assert.equal(event, eventId);
      calls.push('authorize');
      return true;
    },
    list: async () => {
      calls.push('read');
      return [{ attendee_name: 'Ada' }];
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ['authorize', 'read']);
});
void test('invalid filters and unbounded page inputs are rejected', () => {
  for (const suffix of [
    '&page=0',
    '&page=1.5',
    '&page=Infinity',
    '&page=1000001',
    '&status=pending',
    '&field=qr_token_hash',
  ]) {
    assert.equal(
      parseAttendeeQuery(new URLSearchParams(`eventId=${eventId}${suffix}`)),
      null,
    );
  }
  assert.equal(
    parseAttendeeQuery(new URLSearchParams('eventId=invalid')),
    null,
  );
  assert.equal(
    parseAttendeeQuery(
      new URLSearchParams({ eventId, search: 'x'.repeat(201) }),
    ),
    null,
  );
  assert.deepEqual(parseAttendeeQuery(new URLSearchParams({ eventId })), {
    eventId,
    page: 1,
    status: '',
    field: 'attendee_name',
    search: '',
  });
});
void test('search treats wildcard characters as literal text', () => {
  assert.equal(literalSearchPattern('A_50%\\'), '%A\\_50\\%\\\\%');
});
