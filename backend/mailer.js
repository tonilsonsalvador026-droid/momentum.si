const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false, // Gmail usa STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false, // evita erro de certificado
  },
  family: 4, // força IPv4 (evita ::1 erro ECONNREFUSED)
});

async function sendInviteEmail(to, token, nome) {
  const link = `http://192.168.1.238:3000/set-password?token=${token}`;

  const message = {
    from: `"${process.env.EMAIL_FROM_NAME || "Gestão Condomínio"}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
    to,
    subject: "📩 Convite para criar sua conta",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background: #f3f4f6;">
        <div style="max-width: 600px; margin: auto; background: #ffffff; padding: 24px; border-radius: 8px; box-shadow: 0 2px 6px rgba(0,0,0,0.1);">
          <h2 style="color: #2563eb;">Olá ${nome},</h2>
          <p>Você foi convidado para acessar o <b>Sistema de Gestão de Condomínios</b>.</p>
          <p>Clique no botão abaixo para ativar a sua conta e definir uma senha:</p>
          
          <a href="${link}" 
             style="display:inline-block; margin:20px 0; padding:12px 20px; background:#2563eb; color:white; text-decoration:none; border-radius:6px; font-weight:bold;">
             Ativar Conta
          </a>
          
          <p style="font-size: 14px; color: #555;">Este link expira em 24 horas.</p>
          <hr style="margin:20px 0; border:none; border-top:1px solid #e5e7eb;" />
          <p style="font-size: 12px; color: #999;">Se você não solicitou este convite, apenas ignore este email.</p>
        </div>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(message);
    console.log(`✅ Convite enviado com sucesso para ${to}: ${info.messageId}`);
  } catch (error) {
    console.error("❌ Erro ao enviar e-mail:", error);
    throw error;
  }
}

module.exports = { sendInviteEmail };