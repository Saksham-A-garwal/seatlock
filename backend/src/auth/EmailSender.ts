export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
  // Lets the HTML body reference this attachment inline via cid:<contentId>
  // (e.g. a QR code shown in the email body, not just attached).
  contentId?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
