// createAdmin.js
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function createAdmin() {
  try {
    const email = "admin@teste.com";    // Coloque o email que quer usar
    const nome = "Admin Tony";          // Nome do admin
    const password = "123456";          // Senha do admin

    // Verifica se já existe um usuário com esse email
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      console.log("❌ Usuário já existe!");
      return process.exit(0);
    }

    // Hash da senha
    const hashed = await bcrypt.hash(password, 10);

    // Cria o admin
    const admin = await prisma.user.create({
      data: {
        nome,
        email,
        password: hashed,
        role: "admin",
      },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        criadoEm: true,
      },
    });

    console.log("✅ Admin criado com sucesso!");
    console.log(admin);
    process.exit(0);
  } catch (err) {
    console.error("Erro ao criar admin:", err);
    process.exit(1);
  }
}

createAdmin();