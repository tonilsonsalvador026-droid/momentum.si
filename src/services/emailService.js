const nodemailer = require("nodemailer");

const transporter =
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure:
      process.env.SMTP_SECURE === "true",

    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },

    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
  });

async function enviarEmail({
  para,
  assunto,
  html,
}) {
  await transporter.sendMail({
    from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM_ADDRESS}>`,
    to: para,
    subject: assunto,
    html,
  });
}

module.exports = {
  enviarEmail,
};
