/**
 * Mock window.opc.selectDirectory for E2E tests.
 *
 * Native directory pickers cannot be driven in headless Electron E2E runs.
 * Tests that exercise directory inputs can call this helper to replace the
 * preload-exposed implementation with a deterministic stub.
 *
 * The replacement is done through the test-only
 * `window.opc.__setSelectDirectoryImpl` hook exposed by the preload script,
 * because the contextBridge-created `window.opc` object itself is read-only.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} returnPath - path the stub should return
 */
async function mockSelectDirectory(page, returnPath) {
  await page.evaluate((path) => {
    window.opc.__setSelectDirectoryImpl(async () => path);
  }, returnPath);
}

module.exports = { mockSelectDirectory };
