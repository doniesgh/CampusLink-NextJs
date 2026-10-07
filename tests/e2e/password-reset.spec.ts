import { uniqueEmail } from '../support/accounts';
import { expect, test } from '../support/e2e';
import { WEB_URL } from '../support/env';
import { extractResetLink, mailsTo, waitForMail } from '../support/outbox';
import { fillLogin, expectDashboard, formAlert, formStatus } from '../support/ui';

const SENT_MESSAGE = "If an account exists for this email, we've sent a reset link.";

test.describe('Forgot / reset password', () => {
  test('reset through the emailed link, then log in with the new password', async ({ page, api }) => {
    const account = await api.signup({ firstname: 'Ines' });
    const newPassword = 'Ui-Reset-Passw0rd';

    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/forgot-password');

    const before = mailsTo(account.email).length;
    await page.getByLabel('Email').fill(account.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(formStatus(page)).toContainText(SENT_MESSAGE);

    const link = extractResetLink(await waitForMail(account.email, { after: before }));
    expect(link.url.startsWith(`${WEB_URL}/reset-password?token=`)).toBe(true);

    await page.goto(link.url);
    await page.getByLabel('New password').fill(newPassword);
    await page.getByLabel('Confirm password').fill(newPassword);
    await page.getByRole('button', { name: 'Reset password' }).click();

    await expect(page).toHaveURL((url) => url.pathname === '/login' && url.searchParams.get('reset') === '1');
    await expect(formStatus(page)).toContainText('Your password has been reset. You can log in now.');

    // The old password no longer works...
    await fillLogin(page, account.email, account.password);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(formAlert(page)).toContainText('Incorrect email or password.');

    // ...the new one does.
    await fillLogin(page, account.email, newPassword);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expectDashboard(page, 'Ines');
  });

  test('the same confirmation is shown for an unknown email', async ({ page }) => {
    const email = uniqueEmail('ui-ghost');
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(formStatus(page)).toContainText(SENT_MESSAGE);
    expect(mailsTo(email)).toHaveLength(0);
  });

  test('an invalid reset token shows an error', async ({ page }) => {
    await page.goto(`/reset-password?token=${'0'.repeat(64)}`);
    await page.getByLabel('New password').fill('Whatever-Passw0rd');
    await page.getByLabel('Confirm password').fill('Whatever-Passw0rd');
    await page.getByRole('button', { name: 'Reset password' }).click();

    await expect(formAlert(page)).toBeVisible();
    await expect(formAlert(page)).not.toBeEmpty();
    await expect(page).toHaveURL((url) => url.pathname === '/reset-password');
  });
});
