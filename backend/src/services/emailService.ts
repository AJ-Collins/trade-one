import nodemailer from 'nodemailer';


const LOGO_URL = 'https://api.aiscalpingpro.site/images/email-logo.png';

export class EmailService {
  private static transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  private static isSmtpConfigured(): boolean {
    return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
  }

  static async sendReferrerWithdrawalAlert(user: any, amount: number, network: string, toAddress: string) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn('SMTP credentials not configured. Skipping email notification.');
      return;
    }

    const now = new Date();
    // Format: 2026-05-05 17:46:18
    const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);
    const formattedDate = `${dateStr}(UTC)`;
    const amountStr = Number(amount).toFixed(2);
    const fromUser = `User-${Math.random().toString(16).substring(2, 7)}`;

    const mailOptions = {
      from: `"Binance" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: `[Binance] Payment Receive Successful - ${dateStr} (UTC)`,
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e2329;">
  <div style="background-color: #181a20; padding: 20px; text-align: center;">
    <table role="presentation" style="margin: 0 auto; border-collapse: collapse;">
      <tr>
        <td style="padding: 0; vertical-align: middle;">
          <img src="${LOGO_URL}" width="38" height="38" alt="Binance" style="display: block; border: 0;" />
        </td>
        <td style="padding: 0 0 0 8px; vertical-align: middle;">
          <span style="color: #fcd535; font-size: 24px; font-weight: bold; font-family: Arial, sans-serif; line-height: 28px;">BINANCE</span>
        </td>
      </tr>
    </table>
  </div>
  <div style="padding: 30px 20px;">
    <h2 style="font-size: 24px; font-weight: 800; margin-top: 0; margin-bottom: 24px; color: #1e2329;">You received an incoming transfer</h2>
    
    <div style="background-color: #dedede; padding: 20px; margin-bottom: 24px;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <tr>
          <td style="color: #707a8a; padding: 12px 0; width: 80px;">Time:</td>
          <td style="text-align: right; padding: 12px 0;">${formattedDate}</td>
        </tr>
        <tr>
          <td style="color: #707a8a; padding: 12px 0;">From:</td>
          <td style="text-align: right; padding: 12px 0;">${fromUser}</td>
        </tr>
        <tr>
          <td style="color: #707a8a; padding: 12px 0;">Amount:</td>
          <td style="text-align: right; padding: 12px 0;">${amountStr} USDT</td>
        </tr>
      </table>
    </div>

    <a href="#" style="display: inline-block; background-color: #fcd535; color: #1e2329; text-decoration: none; padding: 12px 24px; font-weight: 600; border-radius: 4px; margin-bottom: 40px; font-size: 14px;">View Transaction History</a>

    <p style="color: #1e2329; font-style: italic; margin-bottom: 40px; font-size: 14px;">This is an automated message, please do not reply.</p>

    <div style="border-top: 1px solid #fcd535; padding-top: 24px; text-align: center;">
      <h3 style="color: #c99400; font-size: 16px; margin-bottom: 24px; margin-top: 0; font-weight: 600;">Stay connected!</h3>
      <div style="margin-bottom: 30px;">
        <a href="https://twitter.com/binance" style="display: inline-block; margin: 0 4px; text-decoration: none;"><img src="https://cdn-icons-png.flaticon.com/32/5969/5969020.png" width="24" height="24" alt="X" style="border: 0; filter: grayscale(100%) opacity(60%);" /></a>
        <a href="https://t.me/binance" style="display: inline-block; margin: 0 4px; text-decoration: none;"><img src="https://cdn-icons-png.flaticon.com/32/2111/2111646.png" width="24" height="24" alt="Telegram" style="border: 0; filter: grayscale(100%) opacity(60%);" /></a>
        <a href="https://www.facebook.com/binance" style="display: inline-block; margin: 0 4px; text-decoration: none;"><img src="https://cdn-icons-png.flaticon.com/32/733/733547.png" width="24" height="24" alt="Facebook" style="border: 0; filter: grayscale(100%) opacity(60%);" /></a>        
        <a href="https://www.linkedin.com/company/binance" style="display: inline-block; margin: 0 4px; text-decoration: none;"><img src="https://cdn-icons-png.flaticon.com/32/733/733561.png" width="24" height="24" alt="LinkedIn" style="border: 0; filter: grayscale(100%) opacity(60%);" /></a>                
        <a href="https://www.youtube.com/binanceyoutube" style="display: inline-block; margin: 0 4px; text-decoration: none;"><img src="https://cdn-icons-png.flaticon.com/32/1384/1384060.png" width="24" height="24" alt="YouTube" style="border: 0; filter: grayscale(100%) opacity(60%);" /></a>
        <a href="https://www.reddit.com/r/binance" style="display: inline-block; margin: 0 4px; text-decoration: none;"><img src="https://cdn-icons-png.flaticon.com/32/3670/3670226.png" width="24" height="24" alt="Reddit" style="border: 0; filter: grayscale(100%) opacity(60%);" /></a>
        <a href="https://www.instagram.com/Binance/" style="display: inline-block; margin: 0 4px; text-decoration: none;"><img src="https://cdn-icons-png.flaticon.com/32/2111/2111463.png" width="24" height="24" alt="Instagram" style="border: 0; filter: grayscale(100%) opacity(60%);" /></a>                
      </div>
      
      <p style="text-align: left; font-size: 14px; color: #1e2329; margin-bottom: 24px;">
        To stay secure, setup your anti-phishing code <a href="#" style="color: #fcd535; text-decoration: underline;">here</a>
      </p>
      
      <p style="text-align: left; font-size: 12px; color: #1e2329; line-height: 1.5; margin: 0;">
        <strong>Disclaimer:</strong> Digital asset prices are subject to high market risk and price volatility. The value of your investment may go down or up, and you may not get back the amount invested. You are solely responsible for your investment decisions.
      </p>
    </div>
  </div>
</div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Withdrawal alert email sent to ${user.email}`);
    } catch (error) {
      console.error('Failed to send withdrawal alert email:', error);
    }
  }

  static async sendReferrerDepositAlert(user: any, amount: number, address: string, txId: string) {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      console.warn('SMTP credentials not configured. Skipping email notification.');
      return;
    }

    const now = new Date();
    // Format: 2026-05-05 17:51:06
    const dateStr = now.toISOString().replace('T', ' ').substring(0, 19);
    const amountStr = Number(amount).toFixed(6); // USDT usually shows a few decimals in these emails

    const mailOptions = {
      from: `"Binance" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: `[Binance] USDT Withdrawal Successful - ${dateStr} (UTC)`,
      html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e2329;">
  <div style="background-color: #181a20; padding: 20px; text-align: center;">
    <table role="presentation" style="margin: 0 auto; border-collapse: collapse;">
      <tr>
        <td style="padding: 0; vertical-align: middle;">
          <img src="${LOGO_URL}" width="38" height="38" alt="Binance" style="display: block; border: 0;" />
        </td>
        <td style="padding: 0 0 0 8px; vertical-align: middle;">
          <span style="color: #fcd535; font-size: 24px; font-weight: bold; font-family: Arial, sans-serif; line-height: 28px;">BINANCE</span>
        </td>
      </tr>
    </table>
  </div>
  <div style="padding: 30px 20px;">
    <h2 style="font-size: 24px; font-weight: 600; margin-top: 0; margin-bottom: 24px; color: #1e2329;">USDT Withdrawal Successful</h2>
    
    <p style="font-size: 16px; line-height: 1.5; color: #1e2329; margin-bottom: 24px;">
      You have successfully withdrawn ${amountStr} USDT from your account.
    </p>

    <div style="margin-bottom: 24px;">
      <p style="margin: 0 0 8px 0; font-size: 16px;"><strong>Withdrawal Address:</strong><br/>
      <span style="word-break: break-all; color: #1e2329;">${address}</span></p>
      
      <p style="margin: 0; font-size: 16px;"><strong>Transaction ID:</strong> <span style="word-break: break-all; color: #1e2329;">${txId}</span></p>
    </div>

    <a href="#" style="display: inline-block; background-color: #fcd535; color: #1e2329; text-decoration: none; padding: 12px 24px; font-weight: 600; border-radius: 4px; margin-bottom: 24px; font-size: 16px;">Visit Your Dashboard</a>

    <p style="font-size: 16px; line-height: 1.5; color: #1e2329; margin-bottom: 24px;">
      Don't recognize this activity? Please <a href="#" style="color: #c99400; text-decoration: underline;">reset your password</a> and contact <a href="#" style="color: #c99400; text-decoration: underline;">customer support</a> immediately.
    </p>

    <p style="font-size: 16px; line-height: 1.5; color: #1e2329; margin-bottom: 24px;">
      Please check with the receiving platform or wallet as the transaction is already confirmed on the blockchain explorer.
    </p>

    <p style="color: #1e2329; font-style: italic; margin-bottom: 40px; font-size: 16px;">This is an automated message, please do not reply.</p>
  </div>
</div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Deposit alert email sent to ${user.email}`);
    } catch (error) {
      console.error('Failed to send deposit alert email:', error);
    }
  }


  static async sendPasswordResetEmail(user: any, resetLink: string) {
    const mailOptions = {
      from: `"${process.env.APP_NAME || 'TradeNestBinary'}" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: 'Reset Your Password',
      html: `
  <div style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,sans-serif;color:#111827;">
    <div style="max-width:520px;margin:40px auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;padding:32px;">

      <h1 style="margin:0 0 16px;font-size:22px;font-weight:700;">
        Reset Password
      </h1>

      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4b5563;">
        Hi ${user.name || 'there'},
      </p>

      <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#4b5563;">
        We received a request to reset your password. Click the button below to continue.
      </p>

      <div style="text-align:center;margin:28px 0;">
        <a href="${resetLink}"
          style="display:inline-block;background:#111827;color:#ffffff;
                  text-decoration:none;padding:12px 20px;border-radius:6px;
                  font-size:14px;font-weight:600;">
          Reset Password
        </a>
      </div>

      <div style="background:#f9fafb;border:1px solid #e5e7eb;
                  border-radius:8px;padding:12px;margin-bottom:20px;">
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
          This link expires in <strong>1 hour</strong>. If you didn’t request this, ignore this email.
        </p>
      </div>

      <p style="margin:0 0 6px;font-size:12px;color:#6b7280;">
        If the button doesn’t work, copy this link:
      </p>

      <p style="margin:0;font-size:12px;color:#374151;word-break:break-all;">
        ${resetLink}
      </p>

      <div style="margin-top:28px;border-top:1px solid #e5e7eb;padding-top:16px;">
        <p style="margin:0;font-size:11px;color:#9ca3af;">
          ${process.env.APP_NAME || 'TradeNestBinary'} Security System — automated message
        </p>
      </div>

    </div>
  </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log(`Password reset email sent to ${user.email}`);
    } catch (error) {
      console.error('Failed to send password reset email:', error);
      throw new Error('Failed to send password reset email');
    }
  }
}

