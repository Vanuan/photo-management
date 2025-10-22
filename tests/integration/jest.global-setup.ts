import { setupTestEnvironment } from './setup';

/**
 * Global setup for Jest integration tests
 * This runs once before all test suites
 */
export default async function globalSetup() {
  console.log('\n🚀 Starting global test environment setup...\n');
  
  try {
    await setupTestEnvironment();
    console.log('\n✅ Global test environment setup complete\n');
  } catch (error) {
    console.error('\n❌ Failed to setup global test environment:', error);
    throw error;
  }
}
