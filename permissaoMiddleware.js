const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

function permissao(nomePermissao) {
  return async (req, res, next) => {
    try {
      // O authMiddleware já colocou o utilizador em req.user
      if (!req.user || !req.user.id) {
        return res.status(401).json({
          error: "Utilizador não autenticado.",
        });
      }

      // Buscar o utilizador com a role e permissões
      const utilizador = await prisma.user.findUnique({
        where: {
          id: req.user.id,
        },

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

      if (!utilizador) {
        return res.status(401).json({
          error: "Utilizador não encontrado.",
        });
      }

      if (!utilizador.roleRel) {
        return res.status(403).json({
          error: "Utilizador sem Role atribuída.",
        });
      }

      const permissoes = utilizador.roleRel.permissoes.map(
        (rp) => rp.permissao.nome
      );

      if (!permissoes.includes(nomePermissao)) {
        return res.status(403).json({
          error: "Sem permissão para executar esta operação.",
        });
      }

      next();

    } catch (err) {

      console.error("Erro no middleware de permissões:", err);

      return res.status(500).json({
        error: "Erro interno ao validar permissões.",
      });
    }
  };
}

module.exports = permissao;