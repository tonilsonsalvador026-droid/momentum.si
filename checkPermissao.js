const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function checkPermissao(permissaoNecessaria) {
return async (req, res, next) => {
try {
const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({
      error: "Utilizador não autenticado.",
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roleRel: {
        include: {
          permissoes: {
            include: {
              permissao: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    return res.status(404).json({
      error: "Utilizador não encontrado.",
    });
  }

  const permissoes =
    user.roleRel?.permissoes?.map(
      (rp) => rp.permissao.nome
    ) || [];

  if (!permissoes.includes(permissaoNecessaria)) {
    return res.status(403).json({
      error: "Sem permissão para executar esta ação.",
    });
  }

  next();
} catch (err) {
  console.error("Erro ao validar permissão:", err);

  return res.status(500).json({
    error: "Erro interno ao validar permissões.",
  });
}

};
}

module.exports = checkPermissao;