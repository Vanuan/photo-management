import { teardownTestEnvironment, collectDockerLogs } from './teardown';

/**
 * Global teardown for Jest integration tests
 * This runs once after all test suites
 */
export default async function globalTeardown() {
  console.log('\n🧹 Starting global test environment teardown...\n');
  
  try {
    // Collect logs if tests failed (you can check test results here if needed)
    if (process.env.COLLECT_LOGS === 'true') {
      collectDockerLogs('./test-results/logs');
    }
    
    await teardownTestEnvironment();
    console.log('\n✅ Global test environment teardown complete\n');
  } catch (error) {
    console.error('\n❌ Failed to teardown global test environment:', error);
    // Don't throw - we want to continue cleanup
  }
}
