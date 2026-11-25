import 'dotenv/config';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';

async function registerTempUser(index: number): Promise<string> {
  const email = `conc-test-${Date.now()}-${index}@example.com`;
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      name: `Concurrency Tester ${index}`,
      password: 'TestPassword123!',
    }),
  });
  const data = (await res.json()) as { token?: string; error?: unknown };
  if (!res.ok || !data.token) {
    throw new Error(`Failed to register user ${index}: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function runConcurrencyTest() {
  const concurrency = 12;
  const tokens = await Promise.all(
    Array.from({ length: concurrency }, (_, i) => registerTempUser(i))
  );

  // Fetch active resources using first user token
  const resList = await fetch(`${BASE_URL}/api/resources?activeOnly=true`, {
    headers: { Authorization: `Bearer ${tokens[0]}` },
  });
  const { resources } = (await resList.json()) as {
    resources: Array<{ id: number; name: string }>;
  };
  if (!resources || resources.length === 0) {
    throw new Error('No active resources available for concurrency test.');
  }
  const targetResource = resources[0];

  // Pick a unique future 30-min UTC grid slot 14 days from now at 16:30 UTC
  const now = new Date();
  const slotStart = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 14,
      16,
      30,
      0,
      0
    )
  ).toISOString();

  console.log(
    `Firing ${concurrency} simultaneous POST /api/bookings requests for resource #${targetResource.id} (${targetResource.name}) at ${slotStart}...`
  );

  const responses = await Promise.all(
    tokens.map((token, idx) =>
      fetch(`${BASE_URL}/api/bookings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          resourceId: targetResource.id,
          title: `Concurrency Probe #${idx}`,
          notes: 'Automated race verification',
          startTime: slotStart,
          durationMinutes: 60,
        }),
      }).then(async (r) => ({
        status: r.status,
        body: await r.json(),
      }))
    )
  );

  const created = responses.filter((r) => r.status === 201);
  const conflicts = responses.filter((r) => r.status === 409);
  const other = responses.filter((r) => r.status !== 201 && r.status !== 409);

  console.log(
    `Results -> 201 Created: ${created.length}, 409 Conflict: ${conflicts.length}, Other: ${other.length}`
  );

  if (created.length !== 1 || conflicts.length !== concurrency - 1) {
    console.error('Unexpected distribution:', responses);
    process.exit(1);
  }

  console.log('PASS: Exactly 1 request succeeded (201) and 11 failed atomically (409).');
}

runConcurrencyTest().catch((err) => {
  console.error('Concurrency test failed:', err);
  process.exit(1);
});
