import 'dotenv/config';
import { performance } from 'node:perf_hooks';
import { desc, eq } from 'drizzle-orm';
import { db, pool } from '../backend/src/db/index.ts';
import { tickets } from '../backend/src/db/schema.ts';
import { runSeed } from '../backend/src/db/seed.ts';

async function runBenchmark() {
  console.log('Ensuring 500+ benchmark tickets are seeded...');
  await runSeed({ includeBenchmark500: true });

  const iterations = 10;
  const latenciesMs: number[] = [];

  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await db
      .select()
      .from(tickets)
      .where(eq(tickets.status, 'OPEN'))
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(100)
      .offset(0);
    latenciesMs.push(performance.now() - start);
  }

  latenciesMs.sort((a, b) => a - b);
  const avg = latenciesMs.reduce((a, b) => a + b, 0) / latenciesMs.length;
  const p50 = latenciesMs[Math.floor(latenciesMs.length * 0.5)];
  const p95 = latenciesMs[Math.min(latenciesMs.length - 1, Math.floor(latenciesMs.length * 0.95))];

  console.log(
    `Measured indexed query (limit=100 on 500+ rows): avg=${avg.toFixed(2)}ms, p50=${p50.toFixed(2)}ms, p95=${p95.toFixed(2)}ms`
  );

  await pool.end();
}

runBenchmark().catch(async (err) => {
  console.error('Benchmark failed:', err);
  await pool.end();
  process.exit(1);
});
