import fs from 'node:fs';
import { OUTBOX_FILE } from './env';

/** One line of MAIL_OUTBOX_FILE, written by the backend for every email it sends. */
export type OutboxMail = { to: string; subject: string; text: string; html: string; sentAt: string };

export function readOutbox(): OutboxMail[] {
  let content: string;
  try {
    content = fs.readFileSync(OUTBOX_FILE, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return content
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as OutboxMail];
      } catch {
        return []; // A line still being written by the backend.
      }
    });
}

/** Emails sent to `address`, oldest first. */
export function mailsTo(address: string): OutboxMail[] {
  const wanted = address.toLowerCase();
  return readOutbox().filter((mail) => String(mail.to).toLowerCase() === wanted);
}

/**
 * Waits for a new email to `address` and returns it.
 * `after` is the number of emails to that address already seen (take it with mailsTo() before the action).
 */
export async function waitForMail(
  address: string,
  { after = 0, timeout = 10_000 }: { after?: number; timeout?: number } = {}
): Promise<OutboxMail> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const mails = mailsTo(address);
    if (mails.length > after) return mails[mails.length - 1];
    if (Date.now() > deadline) {
      throw new Error(`No new email to ${address} in ${timeout} ms (outbox: ${OUTBOX_FILE})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The 6-digit verification code of a login email. */
export function extractOtp(mail: OutboxMail): string {
  const match = /\b(\d{6})\b/.exec(mail.text);
  if (!match) throw new Error(`No 6-digit code in email "${mail.subject}": ${mail.text}`);
  return match[1];
}

/** The reset link (and its token) of a password reset email. */
export function extractResetLink(mail: OutboxMail): { url: string; token: string } {
  const match = /(https?:\/\/\S+\/reset-password\?token=([A-Za-z0-9_-]+))/.exec(mail.text);
  if (!match) throw new Error(`No reset link in email "${mail.subject}": ${mail.text}`);
  return { url: match[1], token: match[2] };
}
