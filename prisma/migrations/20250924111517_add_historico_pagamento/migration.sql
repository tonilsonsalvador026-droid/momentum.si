-- CreateTable
CREATE TABLE "public"."HistoricoPagamento" (
    "id" SERIAL NOT NULL,
    "pagamentoId" INTEGER NOT NULL,
    "acao" TEXT NOT NULL,
    "detalhe" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricoPagamento_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."HistoricoPagamento" ADD CONSTRAINT "HistoricoPagamento_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "public"."Pagamento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HistoricoPagamento" ADD CONSTRAINT "HistoricoPagamento_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
