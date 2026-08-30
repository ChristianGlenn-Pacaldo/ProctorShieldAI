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

/**
 * Sends a Welcome email to a newly registered user.
 * 
 * @param toEmail The recipient's email address
 * @param fullName User's full name
 * @param role User's role (student/teacher)
 */
export async function sendWelcomeEmail(toEmail: string, fullName: string, role: string): Promise<boolean> {
  try {
    const roleCapitalized = role.charAt(0).toUpperCase() + role.slice(1);
    const mailOptions = {
      from: `"ProctorShield AI" <${process.env.SMTP_EMAIL}>`,
      to: toEmail,
      subject: `Welcome to ProctorShield AI, ${fullName}!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #2563eb; text-align: center;">Welcome to ProctorShield AI 🛡️</h2>
          <p style="font-size: 16px; color: #333;">Hello <strong>${fullName}</strong>,</p>
          <p style="font-size: 15px; color: #444;">Thank you for signing up as a <strong>${roleCapitalized}</strong> on ProctorShield AI. Your account is active and ready to use.</p>
          <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; border-left: 4px solid #2563eb; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #334155;">
              ProctorShield AI uses state-of-the-art computer vision and AI analysis to guarantee exam integrity and fair assessment.
            </p>
          </div>
          <p style="font-size: 14px; color: #555;">If you have any questions or need assistance, feel free to contact our support team.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">ProctorShield AI Team</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Welcome email sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending Welcome email:', error);
    return false;
  }
}

/**
 * Sends AI Verdict notification email to a student after quiz analysis.
 * 
 * @param toEmail The recipient's email address
 * @param fullName Student's full name
 * @param quizTitle Quiz title
 * @param score Quiz score achieved
 * @param verdict AI final verdict (clean / suspicious / cheated)
 * @param aiExplanation AI generated explanation text
 */
export async function sendVerdictEmail(
  toEmail: string,
  fullName: string,
  quizTitle: string,
  score: number,
  verdict: string,
  aiExplanation: string
): Promise<boolean> {
  try {
    const verdictUpper = verdict.toUpperCase();
    const verdictColor = verdict === 'clean' ? '#16a34a' : verdict === 'suspicious' ? '#d97706' : '#dc2626';

    const mailOptions = {
      from: `"ProctorShield AI" <${process.env.SMTP_EMAIL}>`,
      to: toEmail,
      subject: `Quiz Result & AI Analysis: ${quizTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
          <h2 style="color: #2563eb; text-align: center;">ProctorShield AI Exam Report</h2>
          <p style="font-size: 16px; color: #333;">Hello <strong>${fullName}</strong>,</p>
          <p style="font-size: 15px; color: #444;">Your submission for <strong>${quizTitle}</strong> has been evaluated and analyzed by ProctorShield AI.</p>
          
          <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
            <div style="margin-bottom: 12px;">
              <span style="font-size: 14px; color: #64748b;">Score:</span>
              <strong style="font-size: 18px; color: #0f172a; margin-left: 8px;">${score}%</strong>
            </div>
            <div style="margin-bottom: 12px;">
              <span style="font-size: 14px; color: #64748b;">AI Verdict:</span>
              <span style="display: inline-block; font-size: 13px; font-weight: bold; padding: 4px 12px; border-radius: 9999px; color: #ffffff; background-color: ${verdictColor}; margin-left: 8px;">
                ${verdictUpper}
              </span>
            </div>
            <div>
              <span style="font-size: 14px; color: #64748b; display: block; margin-bottom: 4px;">AI Analysis Summary:</span>
              <p style="font-size: 13px; color: #334155; margin: 0; line-height: 1.5; font-style: italic;">
                "${aiExplanation}"
              </p>
            </div>
          </div>

          <p style="font-size: 13px; color: #64748b;">If you believe this verdict was issued in error, please contact your course instructor.</p>
          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;" />
          <p style="font-size: 12px; color: #888; text-align: center;">ProctorShield AI Automated Reporting</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('Verdict email sent: %s', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending Verdict email:', error);
    return false;
  }
}
