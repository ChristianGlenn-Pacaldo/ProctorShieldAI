import fs from 'node:fs';
import { sanitize, RESULTS } from '../../tests/cloud-auth/runtime.mjs';
export default class AuthenticationReporter {
  cases = [];
  onTestEnd(test, result) {
    const entry = { name: test.title, status: result.status, milliseconds: result.duration,
      errors: result.errors.map(error => sanitize(error.message || 'Test failed')) };
    this.cases.push(entry);
    console.log(`${entry.status}: ${entry.name}`);
    for (const error of entry.errors) console.error(error);
  }
  onError(error) { console.error(sanitize(error.message || 'Authentication test runner error')); }
  onEnd(result) {
    fs.mkdirSync(RESULTS, { recursive: true });
    const counts = Object.fromEntries(['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].map(status => [status, this.cases.filter(value => value.status === status).length]));
    fs.writeFileSync(RESULTS + '/authentication-results.json', JSON.stringify({ overall: result.status, counts, cases: this.cases,
      realPostgreSQL: true, realRedis: true, actualOptimizedHandlers: true,
      googleCertificates: 'SIMULATED_LOCAL_TLS', emailTransport: 'SIMULATED_LOCAL_TLS', liveProviders: 'UNVERIFIED' }, null, 2));
    console.log('Authentication case totals: ' + JSON.stringify(counts));
  }
}
