const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const permissoes = [
  // CONDOMÍNIOS
  ["visualizar_condominios", "Ver condomínios"],
  ["criar_condominios", "Criar condomínios"],
  ["editar_condominios", "Editar condomínios"],
  ["eliminar_condominios", "Eliminar condomínios"],

  // EDIFÍCIOS
  ["visualizar_edificios", "Ver edifícios"],
  ["criar_edificios", "Criar edifícios"],
  ["editar_edificios", "Editar edifícios"],
  ["eliminar_edificios", "Eliminar edifícios"],

  // FRAÇÕES
  ["visualizar_fracoes", "Ver frações"],
  ["criar_fracoes", "Criar frações"],
  ["editar_fracoes", "Editar frações"],
  ["eliminar_fracoes", "Eliminar frações"],

  // PROPRIETÁRIOS
  ["visualizar_proprietarios", "Ver proprietários"],
  ["criar_proprietarios", "Criar proprietários"],
  ["editar_proprietarios", "Editar proprietários"],
  ["eliminar_proprietarios", "Eliminar proprietários"],

  // INQUILINOS
  ["visualizar_inquilinos", "Ver inquilinos"],
  ["criar_inquilinos", "Criar inquilinos"],
  ["editar_inquilinos", "Editar inquilinos"],
  ["eliminar_inquilinos", "Eliminar inquilinos"],

  // PAGAMENTOS
  ["visualizar_pagamentos", "Ver pagamentos"],
  ["criar_pagamentos", "Criar pagamentos"],
  ["editar_pagamentos", "Editar pagamentos"],
  ["eliminar_pagamentos", "Eliminar pagamentos"],

  // RECIBOS
  ["visualizar_recibos", "Ver recibos"],
  ["criar_recibos", "Criar recibos"],
  ["editar_recibos", "Editar recibos"],
  ["eliminar_recibos", "Eliminar recibos"],

  // CONTA CORRENTE
  ["visualizar_conta_corrente", "Ver conta corrente"],
  ["criar_conta_corrente", "Criar conta corrente"],
  ["editar_conta_corrente", "Editar conta corrente"],
  ["eliminar_conta_corrente", "Eliminar conta corrente"],

  // EVENTOS
  ["visualizar_eventos", "Ver eventos"],
  ["criar_eventos", "Criar eventos"],
  ["editar_eventos", "Editar eventos"],
  ["eliminar_eventos", "Eliminar eventos"],

  // SERVIÇOS EXTRAS
  ["visualizar_servicos_extras", "Ver serviços extras"],
  ["criar_servicos_extras", "Criar serviços extras"],
  ["editar_servicos_extras", "Editar serviços extras"],
  ["eliminar_servicos_extras", "Eliminar serviços extras"],

  // SERVIÇOS AGENDADOS
  ["visualizar_servicos_agendados", "Ver serviços agendados"],
  ["criar_servicos_agendados", "Criar serviços agendados"],
  ["editar_servicos_agendados", "Editar serviços agendados"],
  ["eliminar_servicos_agendados", "Eliminar serviços agendados"],

  // UTILIZADORES
  ["visualizar_utilizadores", "Ver utilizadores"],
  ["criar_utilizadores", "Criar utilizadores"],
  ["editar_utilizadores", "Editar utilizadores"],
  ["eliminar_utilizadores", "Eliminar utilizadores"],

  // ROLES
  ["visualizar_roles", "Ver funções"],
  ["criar_roles", "Criar funções"],
  ["editar_roles", "Editar funções"],
  ["eliminar_roles", "Eliminar funções"],

  // PERMISSÕES
  ["visualizar_permissoes", "Ver permissões"],
  ["criar_permissoes", "Criar permissões"],
  ["editar_permissoes", "Editar permissões"],
  ["eliminar_permissoes", "Eliminar permissões"],

  // ATRIBUIR PAPÉIS
  ["visualizar_atribuir_papeis", "Ver atribuição de papéis"],
  ["atribuir_papeis", "Atribuir papéis"],

  // DASHBOARD
  ["visualizar_dashboard", "Ver dashboard"],

  // PERFIL
  ["visualizar_perfil", "Ver perfil"],
  ["editar_perfil", "Editar perfil"],

  // MENSAGENS
  ["visualizar_mensagens", "Ver mensagens"],
  ["criar_mensagens", "Enviar mensagens"]
];

async function seed() {
  console.log("A criar permissões...");

  for (const [nome, descricao] of permissoes) {

    const permissao = await prisma.permissao.upsert({
      where: { nome },
      update: {},
      create: {
        nome,
        descricao,
      },
    });

    const existe = await prisma.rolePermissao.findFirst({
      where: {
        roleId: 1,
        permissaoId: permissao.id,
      },
    });

    if (!existe) {
      await prisma.rolePermissao.create({
        data: {
          roleId: 1,
          permissaoId: permissao.id,
        },
      });
    }
  }

  console.log("=======================================");
  console.log("Permissões atualizadas com sucesso.");
  console.log("Administrador recebeu todas as permissões.");
  console.log("=======================================");

  await prisma.$disconnect();
}

seed().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
});