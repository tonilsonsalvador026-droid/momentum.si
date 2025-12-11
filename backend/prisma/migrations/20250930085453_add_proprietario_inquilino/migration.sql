-- AlterTable
ALTER TABLE "public"."Pagamento" ADD COLUMN     "inquilinoId" INTEGER,
ADD COLUMN     "proprietarioId" INTEGER;

-- AddForeignKey
ALTER TABLE "public"."Pagamento" ADD CONSTRAINT "Pagamento_proprietarioId_fkey" FOREIGN KEY ("proprietarioId") REFERENCES "public"."Proprietario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Pagamento" ADD CONSTRAINT "Pagamento_inquilinoId_fkey" FOREIGN KEY ("inquilinoId") REFERENCES "public"."Inquilino"("id") ON DELETE SET NULL ON UPDATE CASCADE;
