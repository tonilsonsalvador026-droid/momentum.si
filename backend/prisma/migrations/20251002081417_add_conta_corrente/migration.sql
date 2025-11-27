-- CreateTable
CREATE TABLE "public"."ContaCorrente" (
    "id" SERIAL NOT NULL,
    "proprietarioId" INTEGER NOT NULL,
    "saldoInicial" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "saldoAtual" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContaCorrente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Movimento" (
    "id" SERIAL NOT NULL,
    "contaCorrenteId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" DOUBLE PRECISION NOT NULL,
    "descricao" TEXT,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Movimento_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."ContaCorrente" ADD CONSTRAINT "ContaCorrente_proprietarioId_fkey" FOREIGN KEY ("proprietarioId") REFERENCES "public"."Proprietario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Movimento" ADD CONSTRAINT "Movimento_contaCorrenteId_fkey" FOREIGN KEY ("contaCorrenteId") REFERENCES "public"."ContaCorrente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
