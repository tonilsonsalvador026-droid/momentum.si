-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "roleId" INTEGER,
ALTER COLUMN "role" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public"."Role" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Permissao" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,

    CONSTRAINT "Permissao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RolePermissao" (
    "id" SERIAL NOT NULL,
    "roleId" INTEGER NOT NULL,
    "permissaoId" INTEGER NOT NULL,

    CONSTRAINT "RolePermissao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_nome_key" ON "public"."Role"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Permissao_nome_key" ON "public"."Permissao"("nome");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RolePermissao" ADD CONSTRAINT "RolePermissao_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RolePermissao" ADD CONSTRAINT "RolePermissao_permissaoId_fkey" FOREIGN KEY ("permissaoId") REFERENCES "public"."Permissao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
