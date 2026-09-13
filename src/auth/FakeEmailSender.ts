import { EmailSender } from "./EmailSender";

interface SentEmail {
  to: string;
  subject: string;
  body: string;
}

// Test-only EmailSender: records what would have been sent instead of
// calling Resend, so tests can read the OTP code straight out of the body.
export class FakeEmailSender implements EmailSender {
  readonly sent: SentEmail[] = [];

  async send(to: string, subject: string, body: string): Promise<void> {
    this.sent.push({ to, subject, body });
  }

  lastCodeFor(email: string): string {
    const sentEmail = [...this.sent].reverse().find((entry) => entry.to === email);
    const match = sentEmail?.body.match(/\b(\d{6})\b/);
    if (!match) {
      throw new Error(`No OTP code found in sent emails for ${email}`);
    }
    return match[1];
  }
}
