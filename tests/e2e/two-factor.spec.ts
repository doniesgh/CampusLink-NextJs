import { expect, test } from '../support/e2e';
import { extractOtp, mailsTo, waitForMail } from '../support/outbox';
import { expectDashboard, fillLogin, formAlert } from '../support/ui';

test.describe('Two-factor login', () => {
  test('asks for the emailed code, refuses a wrong one, accepts the right one', async ({ page, api }) => {
    const account = await api.signup({ firstname: 'Tarek' });
    await api.enableTwoFactor(account.accessToken);

    const before = mailsTo(account.email).length;
    await page.goto('/login');
    await fillLogin(page, account.email, account.password);
    await page.getByRole('button', { name: 'Log in' }).click();

    const codeInput = page.getByLabel('Verification code');
    await expect(codeInput).toBeVisible();
    const code = extractOtp(await waitForMail(account.email, { after: before }));

    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    await codeInput.fill(wrong);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(formAlert(page)).toBeVisible();
    await expect(formAlert(page)).not.toBeEmpty();

    await page.getByLabel('Verification code').fill(code);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectDashboard(page, 'Tarek');
  });
});
