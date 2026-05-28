require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const authMiddleware = require("../authMiddleware");
const { sendInviteEmail } = require("../mailer"); // 👉 importar mailer

// -----------------------------------------------
// App & Prisma
// -----------------------------------------------
const app = express();
const prisma = new PrismaClient();

// -----------------------------------------------
// Uploads (multer)
// -----------------------------------------------
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${file.fieldname}${ext}`);
  },
});
const upload = multer({ storage });

// -----------------------------------------------
// Middlewares
// -----------------------------------------------
app.use(
  cors({
    origin: ["https://momentum-si-frontend.onrender.com"],
    credentials: true,
  })
);
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// -----------------------------------------------
// Helpers comuns
// -----------------------------------------------
const parseIntOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};
const parseDateOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

const nodemailer = require("nodemailer");
const validator = require("validator");

// 🔹 Configuração global do transporter (feito uma única vez)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true", // true se for porta 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// -----------------------------------------------
// Rota única de SETUP do primeiro admin
// -----------------------------------------------
app.post("/setup/admin", async (req, res) => {
  try {
    const headerToken = req.headers["x-setup-token"];
    if (!headerToken || headerToken !== (process.env.SETUP_TOKEN || "")) {
      return res.status(403).json({ error: "Setup token inválido." });
    }

    const usersCount = await prisma.user.count();
    if (usersCount > 0) {
      return res
        .status(409)
        .json({ error: "Já existe utilizador. Rota de setup desativada." });
    }

    const { nome, email, password } = req.body || {};
    if (!nome || !email || !password) {
      return res
        .status(400)
        .json({ error: "Campos obrigatórios: nome, email, password." });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      return res.status(409).json({ error: "Email já registado." });
    }

    const hashed = await bcrypt.hash(password, 10);
    const admin = await prisma.user.create({
      data: { nome, email, password: hashed, role: "admin" },
      select: { id: true, nome: true, email: true, role: true, criadoEm: true },
    });

    return res.status(201).json({
      message: "✅ Admin criado com sucesso.",
      admin,
    });
  } catch (err) {
    console.error("Erro em /setup/admin:", err);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// -----------------------------------------------
// Login
// -----------------------------------------------
app.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  try {
    if (!email || !password) {
      return res.status(400).json({ error: "Informe email e password." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const token = jwt.sign(
  { id: user.id, role: user.role?.toUpperCase() || "USER" },
  process.env.JWT_SECRET || "segredo_super_secreto",
  { expiresIn: "1h" }
);

    return res.json({
      message: "✅ Login efetuado com sucesso",
      token,
      user: { id: user.id, nome: user.nome, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error("Erro em /login:", err);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// -----------------------------------------------
// Recuperar Password
// -----------------------------------------------
app.post("/auth/recuperar-password", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: "Informe o email." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(404).json({ error: "Utilizador não encontrado." });
    }

    const resetToken = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET || "segredo_super_secreto",
      { expiresIn: "30m" }
    );

    return res.json({
      message: "📩 Link de recuperação enviado para o email informado.",
      resetToken,
    });
  } catch (err) {
    console.error("Erro em /auth/recuperar-password:", err);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// -----------------------------------------------
// Convidar novo usuário ou reenviar convite (admin)
// -----------------------------------------------
app.post("/users/invite", authMiddleware("admin"), async (req, res) => {
  const { nome, email } = req.body || {};

  if (!nome || !email) {
    return res.status(400).json({ error: "Informe nome e email." });
  }

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });

    // 🔹 Caso o utilizador já exista
    if (existingUser) {
      // Se o utilizador já estiver ativo → bloqueia
      if (existingUser.isActive) {
        return res
          .status(409)
          .json({ error: "⚠️ Este utilizador já está ativo no sistema." });
      }

      // Caso esteja inativo → reenvia o convite
      const inviteToken = jwt.sign(
        { id: existingUser.id, email: existingUser.email },
        process.env.JWT_SECRET || "segredo_super_secreto",
        { expiresIn: "1d" }
      );

      try {
        await sendInviteEmail(email, inviteToken, existingUser.nome);
        return res.json({ message: "🔁 Convite reenviado com sucesso." });
      } catch (err) {
        console.error("Erro ao reenviar e-mail:", err);
        return res.status(500).json({
          error:
            "Erro ao reenviar o e-mail de convite. Verifique as configurações do servidor de email.",
        });
      }
    }

    // 🔹 Caso o utilizador não exista ainda → cria e envia convite
    const newUser = await prisma.user.create({
      data: {
        nome,
        email,
        password: "",
        role: "user",
        isActive: false,
      },
    });

    const inviteToken = jwt.sign(
      { id: newUser.id, email: newUser.email },
      process.env.JWT_SECRET || "segredo_super_secreto",
      { expiresIn: "1d" }
    );

    try {
      await sendInviteEmail(email, inviteToken, nome);
      return res.json({
        message: "✅ Convite enviado com sucesso para o email informado.",
      });
    } catch (err) {
      console.error("Erro ao enviar e-mail:", err);
      return res.status(500).json({
        error:
          "Erro ao enviar o e-mail de convite. Verifique as configurações do servidor de email.",
      });
    }
  } catch (err) {
    console.error("Erro em /users/invite:", err);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// -----------------------------------------------
// Definir senha (convite)
// -----------------------------------------------
app.post("/users/set-password", async (req, res) => {
  const { token, password } = req.body || {};

  if (!token || !password) {
    return res.status(400).json({ error: "Token e senha obrigatórios." });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "segredo_super_secreto");
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });

    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        isActive: true,
        role: user.role || "USER", // 👈 define role padrão
      },
    });

    return res.json({ message: "✅ Senha definida com sucesso. Agora você pode fazer login." });
  } catch (err) {
    console.error("Erro em /users/set-password:", err);
    return res.status(400).json({ error: "Token inválido ou expirado." });
  }
});

// -----------------------------------------------
// USERS (CRUD básico)
// -----------------------------------------------
app.get("/users", authMiddleware("admin"), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, nome: true, email: true, role: true, roleId: true, isActive: true, criadoEm: true },
    });
    res.json(users);
  } catch (err) {
    console.error("Erro em GET /users:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

app.post("/users", authMiddleware("admin"), async (req, res) => {
  try {
    const { nome, email, password, role } = req.body;

    if (!nome || !email) {
      return res.status(400).json({ error: "Campos obrigatórios: nome e email." });
    }

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return res.status(409).json({ error: "⚠️ Email já registado." });

    let hashed = null;
    if (password && password.trim() !== "") {
      hashed = await bcrypt.hash(password, 10);
    }

    const user = await prisma.user.create({
      data: {
        nome,
        email,
        password: hashed,
        role: role || "user",
        isActive: false, // o utilizador ainda não confirmou o convite
      },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        isActive: true,
        criadoEm: true,
      },
    });

    res.status(201).json(user);
  } catch (err) {
    console.error("Erro em POST /users:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// -----------------------------------------------
// CONDOMÍNIOS
// -----------------------------------------------
app.get("/condominios", authMiddleware(), async (req, res) => {
  try {
    const condominios = await prisma.condominio.findMany({
      include: {
        gestor: { select: { id: true, nome: true, email: true } },
        edificios: true,
      },
    });

    res.json(condominios);
  } catch (err) {
    console.error("Erro em GET /condominios:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

app.post("/condominios", authMiddleware("admin"), async (req, res) => {
  try {
    const { nome, localizacao, gestorId } = req.body;

    if (!nome || !localizacao || !gestorId) {
      return res
        .status(400)
        .json({ error: "Campos obrigatórios: nome, localizacao, gestorId." });
    }

    const condominio = await prisma.condominio.create({
      data: { nome, localizacao, gestorId },
    });

    res.status(201).json(condominio);
  } catch (err) {
    console.error("Erro em POST /condominios:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// -----------------------------------------------
// EDIFÍCIOS
// -----------------------------------------------
app.get("/edificios", authMiddleware(), async (req, res) => {
  try {
    const edificios = await prisma.edificio.findMany({
      include: {
        condominio: {
          select: { id: true, nome: true }, // só traz o que interessa
        },
        fracoes: true,
      },
      orderBy: { id: "asc" }, // ✅ agora mostra do mais antigo para o mais recente
    });

    res.json(edificios);
  } catch (err) {
    console.error("Erro em GET /edificios:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

app.post("/edificios", authMiddleware("admin"), async (req, res) => {
  try {
    const { nome, endereco, numeroAndares, numeroApartamentos, condominioId } = req.body;

    if (!nome || !condominioId) {
      return res
        .status(400)
        .json({ error: "Campos obrigatórios: nome, condominioId." });
    }

    const edificio = await prisma.edificio.create({
      data: {
        nome,
        endereco,
        numeroAndares: numeroAndares ? parseInt(numeroAndares) : null,
        numeroApartamentos: numeroApartamentos ? parseInt(numeroApartamentos) : null,
        condominioId: parseInt(condominioId),
      },
      include: {
        condominio: { select: { id: true, nome: true } }, // já retorna o nome junto
      },
    });

    res.status(201).json(edificio);
  } catch (err) {
    console.error("Erro em POST /edificios:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// -----------------------------------------------
// DETALHES DO EDIFÍCIO
// -----------------------------------------------
app.get("/edificios/:id", authMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;

    const edificio = await prisma.edificio.findUnique({
      where: { id: parseInt(id) },
      include: {
        condominio: { select: { id: true, nome: true } },
        fracoes: {
          include: {
            proprietario: { select: { id: true, nome: true, email: true, telefone: true } },
            inquilino: { select: { id: true, nome: true, email: true, telefone: true } },
          },
        },
      },
    });

    if (!edificio) {
      return res.status(404).json({ error: "Edifício não encontrado." });
    }

    res.json(edificio);
  } catch (err) {
    console.error("Erro em GET /edificios/:id:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// ------------------------------------------------
// ✅ Pagamentos de um edifício (para histórico)
// ------------------------------------------------
app.get("/edificios/:id/pagamentos", async (req, res) => {
  try {
    const edificioId = parseInt(req.params.id);
    if (isNaN(edificioId))
      return res.status(400).json({ error: "ID inválido" });

    //  Busca as frações do edifício
    const fracoes = await prisma.fracao.findMany({
      where: { edificioId },
      select: { id: true },
    });

    const fracaoIds = fracoes.map((f) => f.id);

    //  Busca pagamentos dessas frações
    const pagamentos = await prisma.pagamento.findMany({
      where: {
        ativo: true,
        fracaoId: { in: fracaoIds },
      },
      include: {
        fracao: {
          include: {
            proprietario: true,
            inquilino: true,
          },
        },
      },
      orderBy: { data: "desc" },
    });

    res.json(pagamentos.map(formatarPagamento));
  } catch (error) {
    console.error("Erro em GET /edificios/:id/pagamentos:", error);
    res.status(500).json({ error: "Erro ao buscar pagamentos do edifício" });
  }
});

// -----------------------------------------------
// HISTÓRICO DO PROPRIETÁRIO
// -----------------------------------------------
app.get("/proprietarios/:id/pagamentos", authMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;
    const pagamentos = await prisma.pagamento.findMany({
      where: { proprietarioId: parseInt(id), ativo: true },
      select: {
        id: true,
        valor: true,
        data: true,
        estado: true,
        descricao: true,
      },
      orderBy: { data: "desc" },
    });
    res.json(pagamentos);
  } catch (err) {
    console.error("Erro ao carregar pagamentos do proprietário:", err);
    res.status(500).json({ error: "Erro ao carregar pagamentos." });
  }
});

// -----------------------------------------------
// SERVIÇOS AGENDADOS DO PROPRIETÁRIO
// -----------------------------------------------
app.get("/proprietarios/:id/servicos-agendados", authMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;
    // Vamos procurar serviços agendados ligados às frações desse proprietário
    const fracoes = await prisma.fracao.findMany({
      where: { proprietarioId: parseInt(id) },
      select: { edificioId: true },
    });

    const edificioIds = fracoes.map((f) => f.edificioId);

    const servicos = await prisma.servicoAgendado.findMany({
      where: {
        edificioId: { in: edificioIds },
      },
      include: {
        servico: { select: { nome: true } },
        edificio: { select: { nome: true } },
      },
      orderBy: { data: "desc" },
    });

    res.json(
      servicos.map((s) => ({
        id: s.id,
        nome: s.servico?.nome || "Serviço",
        edificio: s.edificio?.nome || "—",
        data: s.data,
      }))
    );
  } catch (err) {
    console.error("Erro ao carregar serviços agendados:", err);
    res.status(500).json({ error: "Erro ao carregar serviços agendados." });
  }
});

// -----------------------------------------------
// EVENTOS RELACIONADOS AO CONDOMÍNIO DO PROPRIETÁRIO
// -----------------------------------------------
app.get("/proprietarios/:id/eventos", authMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;

    // Obter o condomínio do edifício da fração do proprietário
    const fracao = await prisma.fracao.findFirst({
      where: { proprietarioId: parseInt(id) },
      include: {
        edificio: {
          include: {
            condominio: true,
          },
        },
      },
    });

    if (!fracao || !fracao.edificio?.condominioId) {
      return res.json([]);
    }

    const eventos = await prisma.evento.findMany({
      where: { condominioId: fracao.edificio.condominioId },
      select: {
        id: true,
        titulo: true,
        data: true,
        descricao: true,
      },
      orderBy: { data: "desc" },
    });

    res.json(eventos);
  } catch (err) {
    console.error("Erro ao carregar eventos do condomínio:", err);
    res.status(500).json({ error: "Erro ao carregar eventos." });
  }
});

// -----------------------------------------------
// ROTA: Enviar mensagem para moradores de um edifício
// -----------------------------------------------
app.post("/mensagens", authMiddleware("admin"), async (req, res) => {
  try {
    const { edificioId, assunto, conteudo } = req.body;

    if (!edificioId || !assunto || !conteudo) {
      return res.status(400).json({
        error: "Campos obrigatórios: edificioId, assunto, conteudo.",
      });
    }

    const edificio = await prisma.edificio.findUnique({
      where: { id: parseInt(edificioId) },
      include: {
        fracoes: {
          include: {
            proprietario: { select: { id: true, nome: true, email: true } },
            inquilino: { select: { id: true, nome: true, email: true } },
          },
        },
      },
    });

    if (!edificio) {
      return res.status(404).json({ error: "Edifício não encontrado." });
    }

    // 🧾 Coleta e valida emails únicos
    const emails = edificio.fracoes.flatMap((f) => [
      f.proprietario?.email,
      f.inquilino?.email,
    ]).filter(Boolean);

    const validEmails = Array.from(
      new Set(emails.filter((em) => validator.isEmail(String(em))))
    );

    if (validEmails.length === 0) {
      return res.status(400).json({
        error: "Nenhum email válido encontrado para os moradores deste edifício.",
      });
    }

    // ✉️ Monta o conteúdo do email
    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || "Gestão Condomínio"}" <${process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
      to: process.env.EMAIL_FROM_ADDRESS, // obrigatório para alguns SMTPs
      bcc: validEmails, // todos recebem em cópia oculta
      subject: assunto,
      text: conteudo,
      html: `
        <div style="font-family: sans-serif; line-height: 1.5;">
          <p>${conteudo.replace(/\n/g, "<br/>")}</p>
          <hr/>
          <p style="font-size: 12px; color: #666;">
            Sistema de Gestão Condominial — Edifício: ${edificio.nome}
          </p>
        </div>
      `,
    };

    // 🚀 Envia o email
    await transporter.sendMail(mailOptions);

    // (Opcional) Grava notificação no DB
    // await prisma.notification.create({
    //   data: {
    //     titulo: assunto,
    //     corpo: conteudo,
    //     edificioId: parseInt(edificioId),
    //     criadoEm: new Date(),
    //   },
    // });

    res.json({
      sucesso: true,
      mensagem: `Mensagem enviada com sucesso para ${validEmails.length} destinatário(s).`,
    });
  } catch (err) {
    console.error("Erro em POST /mensagens:", err);
    res.status(500).json({ error: "Erro interno ao enviar mensagem." });
  }
});

// -----------------------------------------------
// ROTAS DE FRAÇÕES (PRODUÇÃO)
// -----------------------------------------------

// ✅ Listar frações vagas (SEM inquilino)
app.get("/fracoes/vagas", async (req, res) => {
  try {
    const fracoes = await prisma.fracao.findMany({
      where: {
        inquilinoId: null, // 🔥 fonte de verdade
      },
      include: {
        edificio: true,
        proprietario: true,
      },
      orderBy: {
        numero: "asc",
      },
    });

    res.json(fracoes);
  } catch (err) {
    console.error("❌ Erro em GET /fracoes/vagas:", err);
    res.status(500).json({ error: "Erro ao listar frações vagas." });
  }
});

// ✅ Listar todas as frações
app.get("/fracoes", async (req, res) => {
  try {
    const fracoes = await prisma.fracao.findMany({
      include: {
        edificio: true,
        proprietario: true,
        inquilino: true,
      },
      orderBy: { numero: "asc" },
    });

    res.json(fracoes);
  } catch (err) {
    console.error("❌ Erro em GET /fracoes:", err);
    res.status(500).json({ error: "Erro ao listar frações." });
  }
});

// ✅ Buscar fração por ID
app.get("/fracoes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido." });

    const fracao = await prisma.fracao.findUnique({
      where: { id },
      include: { edificio: true, proprietario: true, inquilino: true },
    });

    if (!fracao) {
      return res.status(404).json({ error: "Fração não encontrada." });
    }

    res.json(fracao);
  } catch (err) {
    console.error("❌ Erro em GET /fracoes/:id:", err);
    res.status(500).json({ error: "Erro ao buscar fração." });
  }
});

// ✅ Criar fração
app.post("/fracoes", async (req, res) => {
  try {
    let { numero, tipo, edificioId, proprietarioId, inquilinoId } = req.body;

    edificioId = edificioId ? Number(edificioId) : null;
    proprietarioId = proprietarioId ? Number(proprietarioId) : null;
    inquilinoId = inquilinoId ? Number(inquilinoId) : null;

    // validar edifício
    const edificio = await prisma.edificio.findUnique({
      where: { id: edificioId },
    });
    if (!edificio) {
      return res.status(400).json({ error: "Edifício não encontrado." });
    }

    // validar proprietário
    if (proprietarioId) {
      const proprietario = await prisma.proprietario.findUnique({
        where: { id: proprietarioId },
      });
      if (!proprietario) {
        return res.status(400).json({ error: "Proprietário inválido." });
      }
    }

    let estado = "VAGO";

    // validar inquilino
    if (inquilinoId) {
      const inquilino = await prisma.inquilino.findUnique({
        where: { id: inquilinoId },
      });

      if (!inquilino) {
        return res.status(400).json({ error: "Inquilino inválido." });
      }

      const jaAssociado = await prisma.fracao.findFirst({
        where: { inquilinoId },
      });

      if (jaAssociado) {
        return res.status(400).json({
          error: "Este inquilino já está associado a outra fração.",
        });
      }

      estado = "OCUPADO";
    }

    const fracao = await prisma.fracao.create({
      data: {
        numero,
        tipo,
        estado,
        edificioId,
        proprietarioId,
        inquilinoId,
      },
      include: {
        edificio: true,
        proprietario: true,
        inquilino: true,
      },
    });

    res.status(201).json(fracao);
  } catch (err) {
    console.error("❌ Erro em POST /fracoes:", err);
    res.status(500).json({ error: "Erro ao criar fração." });
  }
});

// ✅ Atualizar fração
app.put("/fracoes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido." });

    let { numero, tipo, edificioId, proprietarioId, inquilinoId } = req.body;

    edificioId = edificioId ? Number(edificioId) : null;
    proprietarioId = proprietarioId ? Number(proprietarioId) : null;
    inquilinoId = inquilinoId ? Number(inquilinoId) : null;

    const fracaoAtual = await prisma.fracao.findUnique({
      where: { id },
    });

    if (!fracaoAtual) {
      return res.status(404).json({ error: "Fração não encontrada." });
    }

    let estado = "VAGO";

    if (inquilinoId) {
      const jaAssociado = await prisma.fracao.findFirst({
        where: {
          inquilinoId,
          NOT: { id },
        },
      });

      if (jaAssociado) {
        return res.status(400).json({
          error: "Este inquilino já está associado a outra fração.",
        });
      }

      estado = "OCUPADO";
    }

    const fracao = await prisma.fracao.update({
      where: { id },
      data: {
        numero,
        tipo,
        estado,
        edificioId,
        proprietarioId,
        inquilinoId,
      },
      include: {
        edificio: true,
        proprietario: true,
        inquilino: true,
      },
    });

    res.json(fracao);
  } catch (err) {
    console.error("❌ Erro em PUT /fracoes/:id:", err);
    res.status(500).json({ error: "Erro ao atualizar fração." });
  }
});

// ✅ Excluir fração
app.delete("/fracoes/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido." });

    const fracao = await prisma.fracao.findUnique({
      where: { id },
    });

    if (!fracao) {
      return res.status(404).json({ error: "Fração não encontrada." });
    }

    await prisma.fracao.delete({
      where: { id },
    });

    res.json({ message: "Fração eliminada com sucesso." });
  } catch (err) {
    console.error("❌ Erro em DELETE /fracoes/:id:", err);
    res.status(500).json({ error: "Erro ao eliminar fração." });
  }
});


// -----------------------------------------------
// ROTAS DE INQUILINOS (PRODUÇÃO)
// -----------------------------------------------

// ✅ Listar inquilinos
app.get("/inquilinos", async (req, res) => {
  try {
    const inquilinos = await prisma.inquilino.findMany({
      include: {
        fracao: {
          include: {
            edificio: true,
          },
        },
      },
    });

    res.json(inquilinos);
  } catch (err) {
    console.error("❌ Erro em GET /inquilinos:", err);
    res.status(500).json({ error: "Erro ao listar inquilinos." });
  }
});

// ✅ Criar inquilino
app.post("/inquilinos", async (req, res) => {
  try {
    const { nome, telefone, email, nif, fracaoId } = req.body;

    const inquilino = await prisma.inquilino.create({
      data: {
        nome,
        telefone,
        email,
        nif,
      },
    });

    if (fracaoId) {
      await prisma.fracao.update({
        where: { id: Number(fracaoId) },
        data: {
          inquilinoId: inquilino.id,
          estado: "OCUPADO",
        },
      });
    }

    res.status(201).json(inquilino);
  } catch (err) {
    console.error("❌ Erro em POST /inquilinos:", err);
    res.status(500).json({ error: "Erro ao criar inquilino." });
  }
});

// ✅ Atualizar inquilino
app.put("/inquilinos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { nome, telefone, email, nif, fracaoId } = req.body;

    const inquilinoAtual = await prisma.inquilino.findUnique({
      where: { id },
      include: { fracao: true },
    });

    if (!inquilinoAtual) {
      return res.status(404).json({ error: "Inquilino não encontrado." });
    }

    // libertar fração antiga
    if (inquilinoAtual.fracao) {
      await prisma.fracao.update({
        where: { id: inquilinoAtual.fracao.id },
        data: {
          inquilinoId: null,
          estado: "VAGO",
        },
      });
    }

    const inquilino = await prisma.inquilino.update({
      where: { id },
      data: {
        nome,
        telefone,
        email,
        nif,
      },
    });

    // nova associação
    if (fracaoId) {
      await prisma.fracao.update({
        where: { id: Number(fracaoId) },
        data: {
          inquilinoId: inquilino.id,
          estado: "OCUPADO",
        },
      });
    }

    res.json(inquilino);
  } catch (err) {
    console.error("❌ Erro em PUT /inquilinos/:id:", err);
    res.status(500).json({ error: "Erro ao atualizar inquilino." });
  }
});

// ✅ Excluir inquilino
app.delete("/inquilinos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    const inquilino = await prisma.inquilino.findUnique({
      where: { id },
    });

    if (!inquilino) {
      return res.status(404).json({ error: "Inquilino não encontrado." });
    }

    // libertar fração
    if (inquilino.fracaoId) {
      await prisma.fracao.update({
        where: { id: inquilino.fracaoId },
        data: {
          inquilinoId: null,
          estado: "VAGO",
        },
      });
    }

    await prisma.inquilino.delete({
      where: { id },
    });

    res.json({ message: "Inquilino excluído com sucesso." });
  } catch (err) {
    console.error("❌ Erro em DELETE /inquilinos/:id:", err);
    res.status(500).json({ error: "Erro ao excluir inquilino." });
  }
});
// -----------------------------------------------
// ROTAS DE PROPRIETÁRIOS
// -----------------------------------------------
app.get("/proprietarios", async (req, res) => {
  try {
    const proprietarios = await prisma.proprietario.findMany({
      include: { fracoes: true },
    });
    res.json(proprietarios);
  } catch (err) {
    console.error("Erro em GET /proprietarios:", err);
    res.status(500).json({ error: "Erro ao listar proprietários." });
  }
});

app.post("/proprietarios", async (req, res) => {
  try {
    const { nome, telefone, email, nif } = req.body;  // 👈 agora pega o nif
    const proprietario = await prisma.proprietario.create({
      data: { nome, telefone, email, nif },           // 👈 agora salva o nif
    });
    res.status(201).json(proprietario);
  } catch (err) {
    console.error("Erro em POST /proprietarios:", err);
    res.status(500).json({ error: "Erro ao criar proprietário." });
  }
});

app.put("/proprietarios/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, telefone, email, nif } = req.body;  // 👈 adiciona nif aqui também
    const proprietario = await prisma.proprietario.update({
      where: { id: Number(id) },
      data: { nome, telefone, email, nif },           // 👈 atualiza o nif também
    });
    res.json(proprietario);
  } catch (err) {
    console.error("Erro em PUT /proprietarios/:id:", err);
    res.status(500).json({ error: "Erro ao atualizar proprietário." });
  }
});

app.delete("/proprietarios/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.proprietario.delete({ where: { id: Number(id) } });
    res.json({ message: "Proprietário eliminado com sucesso." });
  } catch (err) {
    console.error("Erro em DELETE /proprietarios/:id:", err);
    res.status(500).json({ error: "Erro ao eliminar proprietário." });
  }
});

// -----------------------------------------------
// ROTAS DE MOVIMENTOS
// -----------------------------------------------

// Função auxiliar para normalizar valores (aceita "15 000,00", "15000.00", etc.)
function normalizarValor(valor) {
  if (!valor) return 0;
  return parseFloat(
    valor.toString().replace(/\s/g, "").replace(/\./g, "").replace(",", ".")
  );
}

// Função auxiliar para formatar valores em Kz
function formatarKz(valor) {
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "AOA",
    minimumFractionDigits: 2,
  }).format(valor);
}

// Criar novo movimento
app.post("/movimentos", async (req, res) => {
  try {
    const { proprietarioId, data, descricao, tipo, valor } = req.body;

    // Buscar a conta corrente do proprietário
    const conta = await prisma.contaCorrente.findFirst({
      where: { proprietarioId: parseInt(proprietarioId) },
    });

    if (!conta) {
      return res
        .status(404)
        .json({ error: "Conta corrente não encontrada para este proprietário" });
    }

    // Normalizar valor
    const valorNormalizado = normalizarValor(valor);

    // Criar o movimento
    const movimento = await prisma.movimento.create({
      data: {
        contaCorrenteId: conta.id,
        tipo: tipo.toUpperCase(),
        valor: valorNormalizado,
        descricao,
        data: data ? new Date(data) : new Date(),
      },
    });

    // Atualizar saldo atual da conta corrente
    let novoSaldo = conta.saldoAtual;
    if (tipo.toUpperCase() === "CREDITO") {
      novoSaldo += valorNormalizado;
    } else if (tipo.toUpperCase() === "DEBITO") {
      novoSaldo -= valorNormalizado;
    }

    await prisma.contaCorrente.update({
      where: { id: conta.id },
      data: { saldoAtual: novoSaldo },
    });

    // Resposta com dados formatados
    res.json({
      ...movimento,
      valorFormatado: formatarKz(movimento.valor),
      dataFormatada: new Date(movimento.data).toLocaleDateString("pt-PT"),
    });
  } catch (error) {
    console.error("Erro ao registrar movimento:", error);
    res.status(500).json({ error: "Erro ao registrar movimento" });
  }
});

// Listar todos os movimentos
app.get("/movimentos", async (req, res) => {
  try {
    const movimentos = await prisma.movimento.findMany({
      include: { contaCorrente: { include: { proprietario: true } } },
      orderBy: { data: "desc" },
    });

    // Adiciona campos formatados
    const movimentosFormatados = movimentos.map((m) => ({
      ...m,
      valorFormatado: formatarKz(m.valor),
      dataFormatada: new Date(m.data).toLocaleDateString("pt-PT"),
    }));

    res.json(movimentosFormatados);
  } catch (error) {
    console.error("Erro ao listar movimentos:", error);
    res.status(500).json({ error: "Erro ao listar movimentos" });
  }
});

// -----------------------------------------------
// ROTA: Obter total de pagamentos por proprietário
// -----------------------------------------------
app.get("/proprietarios/:id/total-pagos", async (req, res) => {
  try {
    const { id } = req.params;
    const total = await prisma.pagamento.aggregate({
      where: {
        proprietarioId: parseInt(id),
        estado: "PAGO",
        ativo: true,
      },
      _sum: { valor: true },
    });

    res.json({ total: total._sum.valor || 0 });
  } catch (error) {
    console.error("Erro ao calcular total de pagamentos:", error);
    res.status(500).json({ error: "Erro ao calcular total de pagamentos" });
  }
});

// -----------------------------------------------
// ROTAS DE PAGAMENTOS
// -----------------------------------------------

// 🔹 Função auxiliar para calcular tipificação
function calcularTipificacao(pagamento) {
  if (!pagamento) return "Desconhecido";
  if (pagamento.estado === "PAGO") return "Pago";

  if (!pagamento.vencimento) return "Sem vencimento definido";

  const hoje = new Date();
  const vencimento = new Date(pagamento.vencimento);

  if (hoje < vencimento) {
    const diffDias = Math.ceil((vencimento - hoje) / (1000 * 60 * 60 * 24));
    return `Pendente (faltam ${diffDias} dias para vencer)`;
  }

  const diffDias = Math.floor((hoje - vencimento) / (1000 * 60 * 60 * 24));
  if (diffDias <= 15) return `Em atraso leve (${diffDias} dias atrasado)`;
  if (diffDias <= 30) return `Em atraso moderado (${diffDias} dias atrasado)`;
  return `Em atraso grave (${diffDias} dias atrasado)`;
}

// 🔹 Formatar pagamento
function formatarPagamento(pagamento) {
  if (!pagamento) return pagamento;
  return {
    ...pagamento,
    tipificacao: calcularTipificacao(pagamento),
    valorFormatado:
      new Intl.NumberFormat("pt-PT", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(pagamento.valor) + " AOA",
    dataFormatada: pagamento.data
      ? pagamento.data.toISOString().split("T")[0]
      : null,
    vencimentoFormatado: pagamento.vencimento
      ? pagamento.vencimento.toISOString().split("T")[0]
      : null,
  };
}

// ------------------------------------------------
// ✅ Listar pagamentos (ativos) com paginação
// ------------------------------------------------
app.get("/pagamentos", async (req, res) => {
  try {
    const { estado, page = 1, limit = 20 } = req.query;
    const where = { ativo: true };
    if (estado) where.estado = estado.toUpperCase();

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const [pagamentos, total] = await Promise.all([
      prisma.pagamento.findMany({
        where,
        include: {
          user: true,
          fracao: true,
          historico: { include: { user: true } },
          proprietario: true,
          inquilino: true,
        },
        orderBy: { data: "desc" },
        skip,
        take,
      }),
      prisma.pagamento.count({ where }),
    ]);

    res.json({
      data: pagamentos.map(formatarPagamento),
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / take),
    });
  } catch (error) {
    console.error("Erro em GET /pagamentos:", error);
    res.status(500).json({ error: "Erro ao buscar pagamentos" });
  }
});

// ------------------------------------------------
// ✅ Listar pagamentos eliminados (soft delete)
// ------------------------------------------------
app.get("/pagamentos/eliminados", async (req, res) => {
  try {
    const eliminados = await prisma.pagamento.findMany({
      where: { ativo: false },
      include: {
        user: true,
        fracao: true,
        historico: { include: { user: true } },
        proprietario: true,
        inquilino: true,
      },
      orderBy: { data: "desc" },
    });

    res.json(eliminados.map(formatarPagamento));
  } catch (error) {
    console.error("Erro em GET /pagamentos/eliminados:", error);
    res.status(500).json({ error: "Erro ao buscar eliminados" });
  }
});

// ------------------------------------------------
// ✅ Buscar pagamento específico
// ------------------------------------------------
app.get("/pagamentos/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const pagamento = await prisma.pagamento.findUnique({
      where: { id },
      include: {
        user: true,
        fracao: true,
        historico: { include: { user: true } },
        proprietario: true,
        inquilino: true,
      },
    });

    if (!pagamento)
      return res.status(404).json({ error: "Pagamento não encontrado" });

    res.json(formatarPagamento(pagamento));
  } catch (error) {
    console.error("Erro em GET /pagamentos/:id:", error);
    res.status(500).json({ error: "Erro ao buscar pagamento" });
  }
});

// ------------------------------------------------
// ✅ Criar pagamento
// ------------------------------------------------
app.post("/pagamentos", async (req, res) => {
  try {
    let {
      valor,
      descricao,
      estado,
      data,
      vencimento,
      userId,
      fracaoId,
      proprietarioId,
      inquilinoId,
    } = req.body;

    if (typeof valor === "string") {
      valor = valor.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
      valor = parseFloat(valor);
    }

    estado = estado ? estado.toUpperCase() : "PENDENTE";

    const pagamento = await prisma.pagamento.create({
      data: {
        valor,
        descricao,
        estado,
        data: data ? new Date(data) : new Date(),
        vencimento: vencimento ? new Date(vencimento) : null,
        userId: userId ? parseInt(userId) : null,
        fracaoId: fracaoId ? parseInt(fracaoId) : null,
        proprietarioId: proprietarioId ? parseInt(proprietarioId) : null,
        inquilinoId: inquilinoId ? parseInt(inquilinoId) : null,
        ativo: true,
      },
      include: {
        user: true,
        fracao: true,
        proprietario: true,
        inquilino: true,
      },
    });

    res.json(formatarPagamento(pagamento));
  } catch (error) {
    console.error("Erro em POST /pagamentos:", error);
    res.status(500).json({ error: "Erro ao criar pagamento" });
  }
});

// ------------------------------------------------
// ✅ Atualizar pagamento + histórico (corrigido)
// ------------------------------------------------
app.put("/pagamentos/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    let {
      valor,
      descricao,
      estado,
      data,
      vencimento,
      userId,
      fracaoId,
      proprietarioId,
      inquilinoId,
    } = req.body;

    if (typeof valor === "string") {
      valor = valor.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
      valor = parseFloat(valor);
    }

    estado = estado ? estado.toUpperCase() : "PENDENTE";

    const pagamentoAtual = await prisma.pagamento.findUnique({
      where: { id },
    });

    if (!pagamentoAtual)
      return res.status(404).json({ error: "Pagamento não encontrado" });

    // 🔹 Garante que as relações originais não são perdidas
    const pagamentoAtualizado = await prisma.pagamento.update({
      where: { id },
      data: {
        valor,
        descricao,
        estado,
        data: data ? new Date(data) : new Date(),
        vencimento: vencimento ? new Date(vencimento) : null,
        userId: userId ? parseInt(userId) : pagamentoAtual.userId,
        fracaoId: fracaoId ? parseInt(fracaoId) : pagamentoAtual.fracaoId,
        proprietarioId: proprietarioId
          ? parseInt(proprietarioId)
          : pagamentoAtual.proprietarioId,
        inquilinoId: inquilinoId
          ? parseInt(inquilinoId)
          : pagamentoAtual.inquilinoId,
      },
      include: {
        user: true,
        fracao: true,
        proprietario: true,
        inquilino: true,
      },
    });

    // 🔥 histórico detalhado
    const alteracoes = [];
    if (pagamentoAtual.valor !== valor)
      alteracoes.push(`Valor: ${pagamentoAtual.valor} → ${valor}`);
    if (pagamentoAtual.estado !== estado)
      alteracoes.push(`Estado: ${pagamentoAtual.estado} → ${estado}`);
    if (pagamentoAtual.descricao !== descricao)
      alteracoes.push(
        `Descrição: ${pagamentoAtual.descricao || "—"} → ${descricao || "—"}`
      );

    if (
      (pagamentoAtual.vencimento || "").toString() !==
      (vencimento ? new Date(vencimento).toString() : "")
    ) {
      alteracoes.push(
        `Vencimento: ${pagamentoAtual.vencimento || "—"} → ${
          vencimento || "—"
        }`
      );
    }

    if (alteracoes.length > 0) {
      await prisma.historicoPagamento.create({
        data: {
          pagamentoId: pagamentoAtualizado.id,
          acao: "Edição",
          detalhe: alteracoes.join(", "),
          userId: userId ? parseInt(userId) : null,
        },
      });
    }

    res.json(formatarPagamento(pagamentoAtualizado));
  } catch (error) {
    console.error("Erro em PUT /pagamentos/:id:", error);
    res.status(500).json({ error: "Erro ao atualizar pagamento" });
  }
});

// ------------------------------------------------
// ✅ Soft delete (mover para eliminados)
// ------------------------------------------------
app.put("/pagamentos/:id/delete", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const userId = req.body?.userId
      ? parseInt(req.body.userId)
      : req.query?.userId
      ? parseInt(req.query.userId)
      : null;

    const pagamento = await prisma.pagamento.findUnique({ where: { id } });
    if (!pagamento)
      return res.status(404).json({ error: "Pagamento não encontrado" });

    const pagamentoEliminado = await prisma.pagamento.update({
      where: { id },
      data: { ativo: false },
      include: {
        user: true,
        fracao: true,
        proprietario: true,
        inquilino: true,
      },
    });

    await prisma.historicoPagamento.create({
      data: {
        pagamentoId: pagamentoEliminado.id,
        acao: "Eliminação",
        detalhe: `Pagamento eliminado`,
        userId: userId || null,
      },
    });

    res.json({
      message: "Pagamento movido para eliminados",
      pagamento: formatarPagamento(pagamentoEliminado),
    });
  } catch (error) {
    console.error("Erro em PUT /pagamentos/:id/delete:", error);
    res.status(500).json({ error: "Erro ao eliminar pagamento" });
  }
});

// 🚫 DELETE tradicional bloqueado
app.delete("/pagamentos/:id", (req, res) => {
  res.status(405).json({
    error: "Método não permitido. Use PUT /pagamentos/:id/delete",
  });
});

// -----------------------------------------------
// ROTAS DE RECIBOS
// -----------------------------------------------

// Lista de recibos (com paginação)
app.get("/recibos", async (req, res) => {
  try {
    let { page = 1, limit = 10 } = req.query;
    page = parseInt(page);
    limit = parseInt(limit);

    const [data, total] = await Promise.all([
      prisma.recibo.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { id: "desc" },
        include: {
          pagamento: {
            include: {
              proprietario: true,
              fracao: true,
            },
          },
        },
      }),
      prisma.recibo.count(),
    ]);

    const totalPages = Math.ceil(total / limit);
    res.json({ data, total, totalPages });
  } catch (error) {
    console.error("Erro ao listar recibos:", error);
    res.status(500).json({ error: "Erro ao listar recibos." });
  }
});

// Buscar um recibo por ID
app.get("/recibos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const recibo = await prisma.recibo.findUnique({
      where: { id: parseInt(id) },
      include: {
        pagamento: {
          include: {
            proprietario: true,
            fracao: true,
          },
        },
      },
    });

    if (!recibo) return res.status(404).json({ error: "Recibo não encontrado" });
    res.json(recibo);
  } catch (error) {
    console.error("Erro ao buscar recibo:", error);
    res.status(500).json({ error: "Erro ao buscar recibo." });
  }
});

// Criar recibo
app.post("/recibos", async (req, res) => {
  try {
    const { numero, pagamentoId } = req.body;

    const recibo = await prisma.recibo.create({
      data: { numero, pagamentoId },
    });

    res.json(recibo);
  } catch (error) {
    console.error("Erro ao criar recibo:", error);
    res.status(500).json({ error: "Erro ao criar recibo." });
  }
});

// Atualizar recibo
app.put("/recibos/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { numero, pagamentoId } = req.body;

    const recibo = await prisma.recibo.update({
      where: { id: parseInt(id) },
      data: { numero, pagamentoId },
    });

    res.json(recibo);
  } catch (error) {
    console.error("Erro ao atualizar recibo:", error);
    res.status(500).json({ error: "Erro ao atualizar recibo." });
  }
});

// Eliminar recibo
app.delete("/recibos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.recibo.delete({
      where: { id: parseInt(id) },
    });

    res.json({ message: "Recibo eliminado com sucesso!" });
  } catch (error) {
    console.error("Erro ao eliminar recibo:", error);
    res.status(500).json({ error: "Erro ao eliminar recibo." });
  }
});

// -----------------------------------------------
// GERAR PDF do recibo (versão final profissional)
// -----------------------------------------------
const PDFDocument = require("pdfkit");

app.get("/recibos/:id/pdf", async (req, res) => {
  try {
    const { id } = req.params;

    const recibo = await prisma.recibo.findUnique({
      where: { id: parseInt(id) },
      include: {
        pagamento: {
          include: {
            proprietario: true,
            fracao: true,
          },
        },
      },
    });

    if (!recibo) {
      return res.status(404).json({ error: "Recibo não encontrado" });
    }

    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const filename = `recibo_${recibo.id}.pdf`;

    res.setHeader("Content-disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-type", "application/pdf");

    doc.pipe(res);

    // ---------------- CABEÇALHO ----------------
    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text("Condomínio XYZ", { align: "center" });
    doc
      .fontSize(14)
      .font("Helvetica")
      .text("RECIBO DE PAGAMENTO", { align: "center" });
    doc.moveDown(1);

    doc
      .fontSize(10)
      .text(`Data de emissão: ${new Date().toLocaleDateString("pt-PT")}`, {
        align: "right",
      });
    doc.moveDown(2);

    // ---------------- DADOS DO RECIBO ----------------
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("Dados do Recibo", { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(12).font("Helvetica").text(`Número do Recibo: ${recibo.numero}`);
    doc.text(
      `Data do Pagamento: ${
        recibo.data
          ? new Date(recibo.data).toLocaleDateString("pt-PT")
          : "-"
      }`
    );
    doc.moveDown(1.5);

    // ---------------- DADOS DO PROPRIETÁRIO ----------------
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("Proprietário", { underline: true });
    doc.moveDown(0.5);

    doc.fontSize(12).font("Helvetica").text(
      `Nome: ${recibo.pagamento?.proprietario?.nome || "-"}`
    );
    doc.text(`Fração: ${recibo.pagamento?.fracao?.numero || "-"}`);
    doc.moveDown(1.5);

    // ---------------- DADOS DO PAGAMENTO ----------------
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text("Pagamento", { underline: true });
    doc.moveDown(0.5);

    doc
      .fontSize(12)
      .font("Helvetica")
      .text(
        `Valor: ${
          recibo.pagamento?.valor
            ? Number(recibo.pagamento.valor).toLocaleString("pt-PT") + " Kz"
            : "-"
        }`
      );
    doc.text(`Estado: ${recibo.pagamento?.estado || "Pago"}`);
    doc.moveDown(2);

    // ---------------- LINHA DE ASSINATURA ----------------
    const pageHeight = doc.page.height;
    const signatureY = pageHeight - 120; // Assinatura no rodapé

    doc.moveTo(100, signatureY).lineTo(400, signatureY).stroke();
    doc.fontSize(12).text("Assinatura", 220, signatureY + 5, {
      align: "center",
    });

    // ---------------- RODAPÉ ----------------
    doc.fontSize(9).fillColor("gray");
    doc.text("Este recibo foi gerado eletronicamente pelo sistema GC.", 50, pageHeight - 50, {
      align: "center",
      width: 500,
    });

    doc.end();
  } catch (error) {
    console.error("Erro ao gerar PDF do recibo:", error);
    res.status(500).json({ error: "Erro ao gerar PDF do recibo." });
  }
});

// -----------------------------------------------
// Função universal para normalizar valores monetários
// -----------------------------------------------
function normalizarValor(valor) {
  if (valor == null) return 0;
  if (typeof valor === "number") return valor;

  // Remove espaços e pontos de milhar
  valor = valor.toString().replace(/\s/g, "").replace(/\./g, "");

  // Troca vírgula decimal por ponto
  valor = valor.replace(",", ".");

  const numero = parseFloat(valor);
  return isNaN(numero) ? 0 : numero;
}

// Função para formatar valores em Kz
function formatarKz(valor) {
  return (
    new Intl.NumberFormat("pt-PT", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(valor) + " AOA"
  );
}

// -----------------------------------------------
// ROTAS DE CONTA CORRENTE
// -----------------------------------------------
app.get("/contas-correntes", async (req, res) => {
  try {
    const contas = await prisma.contaCorrente.findMany({
      include: { proprietario: true, movimentos: true },
      orderBy: { id: "desc" },
    });

    // adiciona campos formatados
    const contasFormatadas = contas.map((c) => ({
      ...c,
      saldoInicialFormatado: formatarKz(c.saldoInicial),
      saldoAtualFormatado: formatarKz(c.saldoAtual),
    }));

    res.json(contasFormatadas);
  } catch (error) {
    console.error("Erro ao buscar contas correntes:", error);
    res.status(500).json({ error: "Erro ao buscar contas correntes" });
  }
});

app.get("/contas-correntes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const conta = await prisma.contaCorrente.findUnique({
      where: { id: parseInt(id) },
      include: { proprietario: true, movimentos: true },
    });

    if (!conta) {
      return res.status(404).json({ error: "Conta não encontrada" });
    }

    res.json({
      ...conta,
      saldoInicialFormatado: formatarKz(conta.saldoInicial),
      saldoAtualFormatado: formatarKz(conta.saldoAtual),
    });
  } catch (error) {
    console.error("Erro ao buscar conta corrente:", error);
    res.status(500).json({ error: "Erro ao buscar conta corrente" });
  }
});

// Criar nova conta corrente com movimento de abertura
app.post("/contas-correntes", async (req, res) => {
  try {
    const { proprietarioId, saldoInicial } = req.body;

    const valorInicial = normalizarValor(saldoInicial);

    // Cria a conta com saldoAtual = 0
    const conta = await prisma.contaCorrente.create({
      data: {
        proprietarioId: parseInt(proprietarioId),
        saldoInicial: valorInicial,
        saldoAtual: 0, // começa zerado, depois o movimento vai atualizar
      },
    });

    // Se tiver saldo inicial, cria movimento automático
    if (valorInicial > 0) {
      await prisma.movimento.create({
        data: {
          contaCorrenteId: conta.id,
          tipo: "CREDITO",
          valor: valorInicial,
          descricao: "Saldo de abertura",
          data: new Date(),
        },
      });

      // Atualiza saldo da conta
      await prisma.contaCorrente.update({
        where: { id: conta.id },
        data: { saldoAtual: valorInicial },
      });
    }

    // Buscar conta com movimentos e proprietario
    const contaAtualizada = await prisma.contaCorrente.findUnique({
      where: { id: conta.id },
      include: { proprietario: true, movimentos: true },
    });

    res.json({
      ...contaAtualizada,
      saldoInicialFormatado: formatarKz(contaAtualizada.saldoInicial),
      saldoAtualFormatado: formatarKz(contaAtualizada.saldoAtual),
    });
  } catch (error) {
    console.error("Erro ao criar conta corrente:", error);
    res.status(500).json({ error: "Erro ao criar conta corrente" });
  }
});

app.put("/contas-correntes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { saldoInicial, saldoAtual } = req.body;

    const conta = await prisma.contaCorrente.update({
      where: { id: parseInt(id) },
      data: {
        saldoInicial: normalizarValor(saldoInicial),
        saldoAtual: normalizarValor(saldoAtual),
      },
    });

    res.json({
      ...conta,
      saldoInicialFormatado: formatarKz(conta.saldoInicial),
      saldoAtualFormatado: formatarKz(conta.saldoAtual),
    });
  } catch (error) {
    console.error("Erro ao atualizar conta corrente:", error);
    res.status(500).json({ error: "Erro ao atualizar conta corrente" });
  }
});

app.delete("/contas-correntes/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const contaId = parseInt(id);

    // Apaga primeiro os movimentos ligados à conta
    await prisma.movimento.deleteMany({
      where: { contaCorrenteId: contaId },
    });

    // Depois apaga a própria conta
    await prisma.contaCorrente.delete({
      where: { id: contaId },
    });

    res.json({ message: "Conta corrente e movimentos associados excluídos com sucesso" });
  } catch (error) {
    console.error("Erro ao excluir conta corrente:", error);
    res.status(500).json({ error: "Erro ao excluir conta corrente" });
  }
});

// Buscar conta corrente por proprietário
app.get("/contas-correntes/proprietario/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const conta = await prisma.contaCorrente.findFirst({
      where: { proprietarioId: parseInt(id) },
      include: { proprietario: true },
    });

    if (!conta) {
      return res
        .status(404)
        .json({ error: "Nenhuma conta corrente encontrada para este proprietário" });
    }

    res.json({
      ...conta,
      saldoInicialFormatado: formatarKz(conta.saldoInicial),
      saldoAtualFormatado: formatarKz(conta.saldoAtual),
    });
  } catch (error) {
    console.error("Erro ao buscar conta corrente por proprietário:", error);
    res.status(500).json({ error: "Erro ao buscar conta corrente" });
  }
});

// -----------------------------------------------
// ROTAS DE MOVIMENTOS DA CONTA CORRENTE
// -----------------------------------------------
app.post("/contas-correntes/:id/movimentos", async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo, valor, descricao, data } = req.body;

    if (!tipo || !valor) {
      return res.status(400).json({
        error: "Tipo e valor são obrigatórios",
      });
    }

    // 🔥 busca conta
    const conta = await prisma.contaCorrente.findUnique({
      where: { id: parseInt(id) },
    });

    if (!conta) {
      return res.status(404).json({
        error: "Conta não encontrada",
      });
    }

    let novoSaldo = conta.saldoAtual || 0;
    const valorNumerico = parseFloat(valor);

    // 🔥 valida saldo
    if (tipo.toLowerCase() === "credito") {
      novoSaldo += valorNumerico;

    } else if (tipo.toLowerCase() === "debito") {

      // impedir saldo negativo
      if (valorNumerico > conta.saldoAtual) {
        return res.status(400).json({
          error: "Saldo insuficiente para realizar este débito",
        });
      }

      novoSaldo -= valorNumerico;
    }

    // 🔥 cria movimento só depois da validação
    const movimento = await prisma.movimento.create({
      data: {
        contaCorrenteId: parseInt(id),
        tipo,
        valor: valorNumerico,
        descricao,
        data: data ? new Date(data) : new Date(),
      },
    });

    // 🔥 atualiza saldo
    await prisma.contaCorrente.update({
      where: { id: parseInt(id) },
      data: {
        saldoAtual: novoSaldo,
      },
    });

    return res.json(movimento);

  } catch (error) {
    console.error("Erro ao registrar movimento:", error);

    return res.status(500).json({
      error: "Erro ao registrar movimento",
    });
  }
});

// Listar movimentos de uma conta
app.get("/contas-correntes/:id/movimentos", async (req, res) => {
  try {
    const { id } = req.params;

    const conta = await prisma.contaCorrente.findUnique({
      where: { id: parseInt(id) },
    });

    if (!conta) {
      return res.status(404).json({ error: "Conta não encontrada" });
    }

    const movimentos = await prisma.movimento.findMany({
      where: { contaCorrenteId: parseInt(id) },
      orderBy: { data: "asc" },
    });

   // 🔥 cálculo de saldo acumulado
let saldo = 0;

const movimentosComSaldo = movimentos.map((mov) => {
  const valor = mov.valor || 0;

  if (mov.tipo.toLowerCase() === "debito") {
    saldo -= valor;
  } else if (mov.tipo.toLowerCase() === "credito") {
    saldo += valor;
  }

  return {
    ...mov,
    saldoAcumulado: saldo,
  };
});
    // 🔥 totais
    const totalDebito = movimentos
      .filter(m => m.tipo.toLowerCase() === "debito")
      .reduce((acc, m) => acc + (m.valor || 0), 0);

    const totalCredito = movimentos
      .filter(m => m.tipo.toLowerCase() === "credito")
      .reduce((acc, m) => acc + (m.valor || 0), 0);

    const saldoFinal = saldo;

    res.json({
      conta: {
        id: conta.id,
        saldoInicial: conta.saldoInicial,
        saldoAtual: conta.saldoAtual,
      },
      movimentos: movimentosComSaldo,
      totais: {
        totalDebito,
        totalCredito,
        saldoFinal,
      },
    });

  } catch (error) {
    console.error("Erro ao buscar movimentos:", error);
    res.status(500).json({ error: "Erro ao buscar movimentos" });
  }
});

// Eliminar movimento
app.delete("/movimentos/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const movimento = await prisma.movimento.findUnique({
      where: { id: parseInt(id) },
    });

    if (!movimento) {
      return res.status(404).json({
        error: "Movimento não encontrado",
      });
    }

    const contaId = movimento.contaCorrenteId;

    // 🔥 elimina movimento
    await prisma.movimento.delete({
      where: { id: parseInt(id) },
    });

    // 🔥 busca movimentos restantes
    const movimentos = await prisma.movimento.findMany({
      where: { contaCorrenteId: contaId },
    });

    // 🔥 recalcula saldo
    let saldo = 0;

    movimentos.forEach((mov) => {
      if (mov.tipo.toLowerCase() === "credito") {
        saldo += mov.valor || 0;
      } else if (mov.tipo.toLowerCase() === "debito") {
        saldo -= mov.valor || 0;
      }
    });

    // 🔥 atualiza conta
    await prisma.contaCorrente.update({
      where: { id: contaId },
      data: {
        saldoAtual: saldo,
      },
    });

    return res.json({
      message: "Movimento eliminado com sucesso",
    });

  } catch (error) {
    console.error("Erro ao eliminar movimento:", error);

    return res.status(500).json({
      error: "Erro ao eliminar movimento",
    });
  }
});

// -----------------------------------------------
// ROLES (Papéis de Utilizador)
// -----------------------------------------------
app.get("/roles", authMiddleware("admin"), async (req, res) => {
  try {
    const roles = await prisma.role.findMany({
      include: { permissoes: { include: { permissao: true } } },
      orderBy: { id: "asc" },
    });
    res.json(roles);
  } catch (err) {
    console.error("Erro em GET /roles:", err);
    res.status(500).json({ error: "Erro ao obter papéis." });
  }
});

app.get("/roles/:id", authMiddleware("admin"), async (req, res) => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { permissoes: { include: { permissao: true } } },
    });
    if (!role) return res.status(404).json({ error: "Role não encontrada." });
    res.json(role);
  } catch (err) {
    console.error("Erro em GET /roles/:id:", err);
    res.status(500).json({ error: "Erro ao obter role." });
  }
});

app.post("/roles", authMiddleware("admin"), async (req, res) => {
  try {
    const { nome, descricao } = req.body;
    if (!nome) return res.status(400).json({ error: "Nome obrigatório." });

    const exists = await prisma.role.findUnique({ where: { nome } });
    if (exists) return res.status(409).json({ error: "Este papel já existe." });

    const role = await prisma.role.create({ data: { nome, descricao } });
    res.status(201).json(role);
  } catch (err) {
    console.error("Erro em POST /roles:", err);
    res.status(500).json({ error: "Erro ao criar papel." });
  }
});

app.put("/roles/:id", authMiddleware("admin"), async (req, res) => {
  try {
    const { nome, descricao } = req.body;
    const role = await prisma.role.update({
      where: { id: parseInt(req.params.id) },
      data: { nome, descricao },
    });
    res.json(role);
  } catch (err) {
    console.error("Erro em PUT /roles/:id:", err);
    res.status(500).json({ error: "Erro ao atualizar papel." });
  }
});

app.delete("/roles/:id", authMiddleware("admin"), async (req, res) => {
  try {
    await prisma.role.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ message: "Papel removido com sucesso." });
  } catch (err) {
    console.error("Erro em DELETE /roles/:id:", err);
    res.status(500).json({ error: "Erro ao remover papel." });
  }
});

// -----------------------------------------------
// PERMISSÕES
// -----------------------------------------------
app.get("/permissoes", authMiddleware("admin"), async (req, res) => {
  try {
    const permissoes = await prisma.permissao.findMany({
      orderBy: { id: "asc" },
    });
    res.json(permissoes);
  } catch (err) {
    console.error("Erro em GET /permissoes:", err);
    res.status(500).json({ error: "Erro ao obter permissões." });
  }
});

app.post("/permissoes", authMiddleware("admin"), async (req, res) => {
  try {
    const { nome, descricao } = req.body;
    if (!nome) return res.status(400).json({ error: "Nome obrigatório." });

    const exists = await prisma.permissao.findUnique({ where: { nome } });
    if (exists) return res.status(409).json({ error: "Permissão já existe." });

    const permissao = await prisma.permissao.create({ data: { nome, descricao } });
    res.status(201).json(permissao);
  } catch (err) {
    console.error("Erro em POST /permissoes:", err);
    res.status(500).json({ error: "Erro ao criar permissão." });
  }
});

// -----------------------------------------------
// ASSOCIAÇÃO ROLE ↔ PERMISSÕES
// -----------------------------------------------
app.post("/roles/:roleId/permissoes", authMiddleware("admin"), async (req, res) => {
  try {
    const { permissaoIds } = req.body;
    const roleId = parseInt(req.params.roleId);

    if (!Array.isArray(permissaoIds)) {
      return res.status(400).json({ error: "Lista de IDs de permissões obrigatória." });
    }

    // Remove as associações antigas
    await prisma.rolePermissao.deleteMany({ where: { roleId } });

    // Cria novas associações
    const novas = permissaoIds.map((pid) => ({ roleId, permissaoId: pid }));
    await prisma.rolePermissao.createMany({ data: novas });

    const roleAtualizado = await prisma.role.findUnique({
      where: { id: roleId },
      include: { permissoes: { include: { permissao: true } } },
    });

    res.json(roleAtualizado);
  } catch (err) {
    console.error("Erro em POST /roles/:roleId/permissoes:", err);
    res.status(500).json({ error: "Erro ao associar permissões." });
  }
});

// -----------------------------------------------
// ATRIBUIR ROLE A UM USER
// -----------------------------------------------
app.put("/users/:id/role", authMiddleware("admin"), async (req, res) => {
  try {
    const { roleId } = req.body;
    if (!roleId) return res.status(400).json({ error: "roleId obrigatório." });

    const user = await prisma.user.update({
      where: { id: parseInt(req.params.id) },
      data: { roleId },
      include: { roleRel: true },
    });

    res.json({ message: "Papel atribuído com sucesso.", user });
  } catch (err) {
    console.error("Erro em PUT /users/:id/role:", err);
    res.status(500).json({ error: "Erro ao atribuir papel ao utilizador." });
  }
});

// -----------------------------------------------
// ROTAS DE EVENTOS
// -----------------------------------------------

app.get("/eventos", async (req, res) => {

  try {

    const eventos = await prisma.evento.findMany({

      include: {
        condominio: true,
        user: true,
      },

      orderBy: {
        data: "desc",
      },

    });

    res.json(eventos);

  } catch (err) {

    console.error(
      "Erro em GET /eventos:",
      err
    );

    res.status(500).json({
      error: "Erro ao listar eventos.",
    });
  }
});

// -----------------------------------------------
// CRIAR EVENTO
// -----------------------------------------------
app.post("/eventos", async (req, res) => {

  try {

    const {
      titulo,
      descricao,
      data,
      condominioId,
    } = req.body;

    // 🔥 TEMPORÁRIO
    // depois virá do login/token
    const criadoPor = 1;

    const evento = await prisma.evento.create({

      data: {
        titulo,
        descricao,
        data: new Date(data),
        condominioId: Number(condominioId),
        criadoPor,
      },

    });

    res.status(201).json(evento);

  } catch (err) {

    console.error(
      "Erro em POST /eventos:",
      err
    );

    res.status(500).json({
      error: "Erro ao criar evento.",
    });
  }
});

// -----------------------------------------------
// ATUALIZAR EVENTO
// -----------------------------------------------
app.put("/eventos/:id", async (req, res) => {

  try {

    const { id } = req.params;

    const {
      titulo,
      descricao,
      data,
      condominioId,
    } = req.body;

    const eventoAtual = await prisma.evento.findUnique({
      where: {
        id: Number(id),
      },
    });

    if (!eventoAtual) {

      return res.status(404).json({
        error: "Evento não encontrado.",
      });
    }

    const evento = await prisma.evento.update({

      where: {
        id: Number(id),
      },

      data: {
        titulo,
        descricao,
        data: new Date(data),
        condominioId: Number(condominioId),

        // mantém o utilizador original
        criadoPor: eventoAtual.criadoPor,
      },

    });

    res.json(evento);

  } catch (err) {

    console.error(
      "Erro em PUT /eventos/:id:",
      err
    );

    res.status(500).json({
      error: "Erro ao atualizar evento.",
    });
  }
});

// -----------------------------------------------
// ELIMINAR EVENTO
// -----------------------------------------------
app.delete("/eventos/:id", async (req, res) => {

  try {

    const { id } = req.params;

    await prisma.evento.delete({

      where: {
        id: Number(id),
      },

    });

    res.json({
      message:
        "Evento eliminado com sucesso.",
    });

  } catch (err) {

    console.error(
      "Erro em DELETE /eventos/:id:",
      err
    );

    res.status(500).json({
      error: "Erro ao eliminar evento.",
    });
  }
});

// -----------------------------------------------
// ROTAS DE SERVIÇOS EXTRAS
// -----------------------------------------------
app.get("/servicos-extras", async (req, res) => {
  try {
    const servicos = await prisma.servicoExtra.findMany();
    res.json(servicos);
  } catch (err) {
    console.error("Erro em GET /servicos-extras:", err);
    res.status(500).json({ error: "Erro ao listar serviços extras." });
  }
});

app.post("/servicos-extras", async (req, res) => {
  try {
    const { nome, descricao, valor } = req.body;
    const servico = await prisma.servicoExtra.create({
      data: { nome, descricao, valor },
    });
    res.status(201).json(servico);
  } catch (err) {
    console.error("Erro em POST /servicos-extras:", err);
    res.status(500).json({ error: "Erro ao criar serviço extra." });
  }
});

app.put("/servicos-extras/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, descricao, valor } = req.body;
    const servico = await prisma.servicoExtra.update({
      where: { id: Number(id) },
      data: { nome, descricao, valor },
    });
    res.json(servico);
  } catch (err) {
    console.error("Erro em PUT /servicos-extras/:id:", err);
    res.status(500).json({ error: "Erro ao atualizar serviço extra." });
  }
});

app.delete("/servicos-extras/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.servicoExtra.delete({ where: { id: Number(id) } });
    res.json({ message: "Serviço extra eliminado com sucesso." });
  } catch (err) {
    console.error("Erro em DELETE /servicos-extras/:id:", err);
    res.status(500).json({ error: "Erro ao eliminar serviço extra." });
  }
});

// -----------------------------------------------
// ROTAS DE SERVIÇOS AGENDADOS
// -----------------------------------------------
app.get("/servicos-agendados", async (req, res) => {
  try {
    const agendados = await prisma.servicoAgendado.findMany({
      include: { servico: true },
    });
    res.json(agendados);
  } catch (err) {
    console.error("Erro em GET /servicos-agendados:", err);
    res.status(500).json({ error: "Erro ao listar serviços agendados." });
  }
});

app.post("/servicos-agendados", async (req, res) => {
  try {
    const { data, servicoId, observacoes, userId } = req.body;

    const agendado = await prisma.servicoAgendado.create({
      data: {
        data: new Date(data),
        observacoes,
        servicoId: Number(servicoId),
        userId: Number(userId),
      },
    });

    res.status(201).json(agendado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar serviço agendado." });
  }
});

app.put("/servicos-agendados/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { data, servicoId, observacoes, userId } = req.body;

    const agendado = await prisma.servicoAgendado.update({
      where: { id: Number(id) },
      data: {
        data: new Date(data),
        observacoes,
        servicoId: Number(servicoId),
        userId: Number(userId),
      },
    });

    res.json(agendado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar serviço agendado." });
  }
});

app.delete("/servicos-agendados/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.servicoAgendado.delete({ where: { id: Number(id) } });
    res.json({ message: "Serviço agendado eliminado com sucesso." });
  } catch (err) {
    console.error("Erro em DELETE /servicos-agendados/:id:", err);
    res.status(500).json({ error: "Erro ao eliminar serviço agendado." });
  }
});

// ----------------------------------------------- 
// ROTAS DE PAGAMENTOS + HISTÓRICO
// -----------------------------------------------

// ✅ Listar todos os pagamentos
app.get("/pagamentos", authMiddleware(), async (req, res) => {
  try {
    const pagamentos = await prisma.pagamento.findMany({
      include: {
        user: true,
        fracao: true,
        recibo: true,
      },
      orderBy: { data: "desc" },
    });

    const pagamentosFormatados = pagamentos.map((p) => ({
      ...p,
      valorFormatado:
        new Intl.NumberFormat("pt-PT", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(p.valor) + " AOA",
    }));

    res.json(pagamentosFormatados);
  } catch (error) {
    console.error("Erro em GET /pagamentos:", error);
    res.status(500).json({ error: "Erro ao buscar pagamentos" });
  }
});

// ✅ Criar pagamento
app.post("/pagamentos", authMiddleware(), async (req, res) => {
  try {
    let { valor, descricao, estado, data, fracaoId } = req.body;
    const userId = req.user.id; // 🔹 vem do token

    if (typeof valor === "string") {
      valor = valor.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
      valor = parseFloat(valor);
    }

    const pagamento = await prisma.pagamento.create({
      data: {
        valor,
        descricao,
        estado,
        data: data ? new Date(data) : new Date(),
        userId,
        fracaoId: fracaoId ? parseInt(fracaoId) : null,
      },
      include: { user: true, fracao: true },
    });

    // 🔹 Regista no histórico
    await prisma.historicoPagamento.create({
      data: {
        pagamentoId: pagamento.id,
        acao: "CRIAR",
        detalhe: `Pagamento de ${pagamento.valor} AOA criado`,
        userId,
      },
    });

    res.json({
      ...pagamento,
      valorFormatado:
        new Intl.NumberFormat("pt-PT", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(pagamento.valor) + " AOA",
    });
  } catch (error) {
    console.error("Erro em POST /pagamentos:", error);
    res.status(500).json({ error: "Erro ao criar pagamento" });
  }
});

// ✅ Atualizar pagamento
app.put("/pagamentos/:id", authMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;
    let { valor, descricao, estado, data, fracaoId } = req.body;
    const userId = req.user.id; // 🔹 vem do token

    if (typeof valor === "string") {
      valor = valor.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
      valor = parseFloat(valor);
    }

    const pagamento = await prisma.pagamento.update({
      where: { id: parseInt(id) },
      data: {
        valor,
        descricao,
        estado,
        data: data ? new Date(data) : new Date(),
        userId, // atualizado pelo user autenticado
        fracaoId: fracaoId ? parseInt(fracaoId) : null,
      },
      include: { user: true, fracao: true },
    });

    // 🔹 Regista no histórico
    await prisma.historicoPagamento.create({
      data: {
        pagamentoId: pagamento.id,
        acao: "EDITAR",
        detalhe: `Pagamento atualizado para ${pagamento.valor} AOA, estado: ${pagamento.estado}`,
        userId,
      },
    });

    res.json({
      ...pagamento,
      valorFormatado:
        new Intl.NumberFormat("pt-PT", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(pagamento.valor) + " AOA",
    });
  } catch (error) {
    console.error("Erro em PUT /pagamentos/:id:", error);
    res.status(500).json({ error: "Erro ao atualizar pagamento" });
  }
});

// ✅ Eliminar pagamento
app.delete("/pagamentos/:id", authMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id; // 🔹 vem do token

    const pagamento = await prisma.pagamento.delete({
      where: { id: parseInt(id) },
      include: { user: true, fracao: true },
    });

    // 🔹 Regista no histórico
    await prisma.historicoPagamento.create({
      data: {
        pagamentoId: pagamento.id,
        acao: "ELIMINAR",
        detalhe: `Pagamento de ${pagamento.valor} AOA eliminado`,
        userId,
      },
    });

    res.json({ message: "Pagamento eliminado com sucesso" });
  } catch (error) {
    console.error("Erro em DELETE /pagamentos/:id:", error);
    res.status(500).json({ error: "Erro ao eliminar pagamento" });
  }
});

// ✅ Listar histórico de um pagamento
app.get("/pagamentos/:id/historico", authMiddleware(), async (req, res) => {
  try {
    const { id } = req.params;

    const historico = await prisma.historicoPagamento.findMany({
      where: { pagamentoId: parseInt(id) },
      include: { user: true },
      orderBy: { data: "desc" },
    });

    res.json(historico);
  } catch (error) {
    console.error("Erro em GET /pagamentos/:id/historico:", error);
    res.status(500).json({ error: "Erro ao buscar histórico" });
  }
});

// -----------------------------------------------
// Inicializar Servidor
// -----------------------------------------------
const PORT = process.env.PORT || 5000; // 👈 esta linha tem de vir antes do app.listen

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor a correr na porta ${PORT} (acessível pela rede local)`);
});
