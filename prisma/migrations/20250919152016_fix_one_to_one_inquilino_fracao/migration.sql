/*
  Warnings:

  - A unique constraint covering the columns `[inquilinoId]` on the table `Fracao` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Fracao_inquilinoId_key" ON "public"."Fracao"("inquilinoId");
