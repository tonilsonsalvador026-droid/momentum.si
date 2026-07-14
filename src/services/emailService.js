import nodemailer from "nodemailer";
import { prisma } from "../prisma.js";

export async function enviarEmail({
  para,
  assunto,
  html,
}) {
  try {
    const config =
      await prisma.configuracaoEmail.findFirst({
        where: {
          ativo: true,
        },
      });

    if (!config) {
      throw new Error(
        "Nenhuma configuração de email ativa."
      );
    }

    const transporter =
      nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: false,
        auth: {
          user: config.email,
          pass: config.password,
        },
        tls: {
          rejectUnauthorized: false,
        },
      });

    await transporter.sendMail({
      from: `"${config.remetente}" <${config.email}>`,
      to: para,
      subject: assunto,
      html,
    });

    console.log(
      `✅ Email enviado para ${para}`
    );
  } catch (err) {
    console.error(
      "Erro ao enviar email:",
      err
    );
  }
}