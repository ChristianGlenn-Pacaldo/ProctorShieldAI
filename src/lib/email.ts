import nodemailer from 'nodemailer';

// Configure the transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_EMAIL,
    pass: process.env.SMTP_PASSWORD,
  },
});

/**
 * Sends a 6-digit OTP code to the provided email address.
 * 
 * @param toEmail The recipient's email address
 * @param otpCode The 6-digit One-Time Password
 */
export async function sendOtpEmail(toEmail: string, otpCode: string): Promise<boolean> {
  try {
    const mailOptions = {
      from: `"ProctorShield AI" <${process.env.SMTP_EMAIL}>`,
      to: toEmail,
      subject: 'Your ProctorShield AI Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #4f46e5; text-align: center;">ProctorShield AI</h2>
          <p style="font-size: 16px; color: #333;">Hello,</p>
          <p style="font-size: 16px; color: #333;">You are attempting to sign in to ProctorShield AI. Please use the following One-Time Password (OTP) to complete your login:</p>
          <div style="background-color: #f3f4f6; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #111;">${otpCode}</span>
          </div>
          <p style="font-size: 14px; color: #555;">This code is valid for 10 minutes. If you did not request this code, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">ProctorShield AI Security Team</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('OTP Email sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending OTP email:', error);
    return false;
  }
}
