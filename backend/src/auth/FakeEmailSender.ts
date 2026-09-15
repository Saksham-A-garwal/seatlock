import { EmailMessage, EmailSender } from "./EmailSender";

// Test-only EmailSender: records what would have been sent instead of
// calling Resend, so tests can read the OTP code -- or a booking
// confirmation's contents -- straight out of the recorded message.
export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastCodeFor(email: string): string {
    const sentEmail = [...this.sent].reverse().find((entry) => entry.to === email);
    const match = sentEmail?.text.match(/\b(\d{6})\b/);
    if (!match) {
      throw new Error(`No OTP code found in sent emails for ${email}`);
    }
    return match[1];
  }
}
