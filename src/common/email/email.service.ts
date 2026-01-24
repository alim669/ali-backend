/**
 * Email Service - خدمة إرسال البريد الإلكتروني
 * تدعم SMTP مع قوالب متعددة
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

export interface EmailOptions {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  template?: EmailTemplate;
  data?: Record<string, any>;
}

export type EmailTemplate =
  | 'welcome'
  | 'password-reset'
  | 'email-verification'
  | 'gift-received'
  | 'account-suspended'
  | 'vip-activated';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private isConfigured = false;

  constructor(private config: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const host = this.config.get<string>('SMTP_HOST');
    const user = this.config.get<string>('SMTP_USER');
    const password = this.config.get<string>('SMTP_PASSWORD');

    if (!host || !user || !password) {
      this.logger.warn('⚠️ Email service not configured - missing SMTP credentials');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: this.config.get<number>('SMTP_PORT', 587) === 465,
        auth: {
          user,
          pass: password,
        },
        tls: {
          rejectUnauthorized: false, // For development
        },
      });

      this.isConfigured = true;
      this.logger.log('✅ Email service initialized');
    } catch (error) {
      this.logger.error('Failed to initialize email service:', error.message);
    }
  }

  isEnabled(): boolean {
    return this.isConfigured && this.transporter !== null;
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.warn(`Email not sent (service disabled): ${options.subject}`);
      return false;
    }

    try {
      const fromEmail = this.config.get<string>('SMTP_FROM_EMAIL');
      const fromName = this.config.get<string>('SMTP_FROM_NAME', 'Ali App');

      let html = options.html;
      if (options.template) {
        html = this.renderTemplate(options.template, options.data || {});
      }

      const result = await this.transporter!.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        text: options.text,
        html,
      });

      this.logger.log(`Email sent: ${options.subject} to ${options.to}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email: ${error.message}`);
      return false;
    }
  }

  // ================================
  // TEMPLATE METHODS
  // ================================

  async sendWelcomeEmail(email: string, username: string): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'مرحباً بك في تطبيق علي! 🎉',
      template: 'welcome',
      data: { username },
    });
  }

  async sendPasswordResetEmail(email: string, resetToken: string): Promise<boolean> {
    const resetUrl = `${this.config.get('APP_URL', 'https://ali-app.com')}/reset-password?token=${resetToken}`;
    
    return this.sendEmail({
      to: email,
      subject: 'إعادة تعيين كلمة المرور',
      template: 'password-reset',
      data: { resetUrl },
    });
  }

  async sendEmailVerification(email: string, verificationToken: string): Promise<boolean> {
    const verifyUrl = `${this.config.get('APP_URL', 'https://ali-app.com')}/verify-email?token=${verificationToken}`;
    
    return this.sendEmail({
      to: email,
      subject: 'تأكيد البريد الإلكتروني',
      template: 'email-verification',
      data: { verifyUrl },
    });
  }

  async sendGiftNotification(
    email: string,
    senderName: string,
    giftName: string,
    quantity: number,
  ): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: `${senderName} أرسل لك هدية! 🎁`,
      template: 'gift-received',
      data: { senderName, giftName, quantity },
    });
  }

  async sendAccountSuspendedEmail(email: string, reason: string): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'تم تعليق حسابك',
      template: 'account-suspended',
      data: { reason },
    });
  }

  async sendVIPActivatedEmail(email: string, expiresAt: Date): Promise<boolean> {
    return this.sendEmail({
      to: email,
      subject: 'تم تفعيل عضوية VIP! ⭐',
      template: 'vip-activated',
      data: { expiresAt: expiresAt.toLocaleDateString('ar-SA') },
    });
  }

  // ================================
  // TEMPLATE RENDERING
  // ================================

  private renderTemplate(template: EmailTemplate, data: Record<string, any>): string {
    const templates: Record<EmailTemplate, (data: any) => string> = {
      welcome: this.welcomeTemplate,
      'password-reset': this.passwordResetTemplate,
      'email-verification': this.emailVerificationTemplate,
      'gift-received': this.giftReceivedTemplate,
      'account-suspended': this.accountSuspendedTemplate,
      'vip-activated': this.vipActivatedTemplate,
    };

    return templates[template](data);
  }

  private welcomeTemplate(data: { username: string }): string {
    return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; }
    .header { text-align: center; color: #7C3AED; }
    .content { padding: 20px 0; line-height: 1.8; }
    .button { display: inline-block; background: #7C3AED; color: white; padding: 12px 30px; border-radius: 25px; text-decoration: none; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 مرحباً بك في علي!</h1>
    </div>
    <div class="content">
      <p>مرحباً <strong>${data.username}</strong>،</p>
      <p>نحن سعداء بانضمامك إلى مجتمع علي! يمكنك الآن:</p>
      <ul>
        <li>💬 الانضمام للغرف والدردشة مع الأصدقاء</li>
        <li>🎁 إرسال واستقبال الهدايا</li>
        <li>👥 متابعة أشخاص جدد</li>
        <li>⭐ الترقية لـ VIP للحصول على مزايا حصرية</li>
      </ul>
      <p>ابدأ الآن واستمتع بتجربة رائعة!</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Ali App. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  private passwordResetTemplate(data: { resetUrl: string }): string {
    return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; }
    .header { text-align: center; color: #7C3AED; }
    .content { padding: 20px 0; line-height: 1.8; }
    .button { display: inline-block; background: #7C3AED; color: white; padding: 12px 30px; border-radius: 25px; text-decoration: none; margin: 20px 0; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 30px; }
    .warning { background: #FEF3C7; padding: 15px; border-radius: 8px; color: #92400E; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 إعادة تعيين كلمة المرور</h1>
    </div>
    <div class="content">
      <p>تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك.</p>
      <p>اضغط على الزر التالي لإعادة تعيين كلمة المرور:</p>
      <p style="text-align: center;">
        <a href="${data.resetUrl}" class="button">إعادة تعيين كلمة المرور</a>
      </p>
      <div class="warning">
        <strong>⚠️ تنبيه:</strong> هذا الرابط صالح لمدة ساعة واحدة فقط. إذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذا البريد.
      </div>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Ali App. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  private emailVerificationTemplate(data: { verifyUrl: string }): string {
    return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; }
    .header { text-align: center; color: #7C3AED; }
    .content { padding: 20px 0; line-height: 1.8; text-align: center; }
    .button { display: inline-block; background: #10B981; color: white; padding: 12px 30px; border-radius: 25px; text-decoration: none; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✉️ تأكيد البريد الإلكتروني</h1>
    </div>
    <div class="content">
      <p>شكراً لتسجيلك في تطبيق علي!</p>
      <p>يرجى تأكيد بريدك الإلكتروني بالضغط على الزر التالي:</p>
      <p>
        <a href="${data.verifyUrl}" class="button">تأكيد البريد الإلكتروني</a>
      </p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Ali App. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  private giftReceivedTemplate(data: { senderName: string; giftName: string; quantity: number }): string {
    return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; }
    .header { text-align: center; color: #7C3AED; }
    .gift-box { background: linear-gradient(135deg, #7C3AED, #EC4899); color: white; padding: 30px; border-radius: 15px; text-align: center; margin: 20px 0; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎁 لديك هدية جديدة!</h1>
    </div>
    <div class="gift-box">
      <h2>${data.senderName}</h2>
      <p>أرسل لك</p>
      <h1>${data.giftName} x${data.quantity}</h1>
    </div>
    <p style="text-align: center;">افتح التطبيق لرؤية هديتك!</p>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Ali App. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  private accountSuspendedTemplate(data: { reason: string }): string {
    return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; }
    .header { text-align: center; color: #EF4444; }
    .content { padding: 20px 0; line-height: 1.8; }
    .reason-box { background: #FEE2E2; padding: 15px; border-radius: 8px; border-right: 4px solid #EF4444; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ تم تعليق حسابك</h1>
    </div>
    <div class="content">
      <p>نأسف لإبلاغك بأن حسابك تم تعليقه للسبب التالي:</p>
      <div class="reason-box">
        <strong>السبب:</strong> ${data.reason}
      </div>
      <p>إذا كنت تعتقد أن هذا خطأ، يرجى التواصل مع فريق الدعم.</p>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Ali App. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  private vipActivatedTemplate(data: { expiresAt: string }): string {
    return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 10px; padding: 30px; }
    .header { text-align: center; background: linear-gradient(135deg, #F59E0B, #EF4444); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .vip-badge { background: linear-gradient(135deg, #F59E0B, #EF4444); color: white; padding: 30px; border-radius: 15px; text-align: center; margin: 20px 0; }
    .features { padding: 20px; }
    .feature { display: flex; align-items: center; padding: 10px 0; border-bottom: 1px solid #eee; }
    .footer { text-align: center; color: #888; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⭐ مبروك! أنت الآن VIP</h1>
    </div>
    <div class="vip-badge">
      <h2>👑 عضوية VIP</h2>
      <p>صالحة حتى: ${data.expiresAt}</p>
    </div>
    <div class="features">
      <h3>مميزاتك الحصرية:</h3>
      <div class="feature">✨ شارة VIP مميزة</div>
      <div class="feature">🚀 أولوية في الدخول للغرف</div>
      <div class="feature">🎁 هدايا حصرية</div>
      <div class="feature">💎 خصومات على الشراء</div>
    </div>
    <div class="footer">
      <p>© ${new Date().getFullYear()} Ali App. جميع الحقوق محفوظة.</p>
    </div>
  </div>
</body>
</html>
    `;
  }

  // ================================
  // VERIFY CONNECTION
  // ================================

  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      return true;
    } catch (error) {
      this.logger.error('Email connection verification failed:', error.message);
      return false;
    }
  }
}
