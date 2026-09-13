import { Resend } from "resend";
import { config } from "../config";
import { EmailSender } from "./EmailSender";

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor() {
    this.client = new Resend(config.resendApiKey);
  }

  async send(to: string, subject: string, body: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: `SeatLock <${config.emailFrom}>`,
      to,
      subject,
      text: body,
    });

    if (error) {
      throw new Error(`Failed to send email via Resend: ${error.message}`);
    }
  }
}
