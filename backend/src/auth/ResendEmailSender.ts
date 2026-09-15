import { Resend } from "resend";
import { config } from "../config";
import { isRetryableEmailError } from "../resilience/isRetryableEmailError";
import { withRetry } from "../resilience/withRetry";
import { EmailMessage, EmailSender } from "./EmailSender";

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor() {
    this.client = new Resend(config.resendApiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    // Resend models an API-level rejection as a resolved { error } value,
    // never a thrown exception -- so only a genuine transport failure ever
    // reaches withRetry here (see isRetryableEmailError).
    const { error } = await withRetry(
      () =>
        this.client.emails.send({
          from: `SeatLock <${config.emailFrom}>`,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          ...(message.attachments
            ? {
                attachments: message.attachments.map((attachment) => ({
                  filename: attachment.filename,
                  content: attachment.content,
                  ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
                  ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
                })),
              }
            : {}),
        }),
      { ...config.resilience, isRetryable: isRetryableEmailError }
    );

    if (error) {
      throw new Error(`Failed to send email via Resend: ${error.message}`);
    }
  }
}
