CREATE TYPE "StatusRelatorioAnalitico" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHOU');
CREATE TYPE "TipoRelatorioAnalitico" AS ENUM ('PACOTE_ANALITICO');
CREATE TYPE "OrigemObservacaoCondicao" AS ENUM ('RECEBIMENTO', 'ALTERACAO_CONDICAO', 'HISTORICO_IMPORTADO');

ALTER TABLE "equipamentos" ADD COLUMN "marca" VARCHAR(100);
ALTER TABLE "equipamentos" ADD COLUMN "modelo" VARCHAR(100);
ALTER TABLE "equipamentos" ADD COLUMN "valor_recuperacao_estimado_centavos" INTEGER;
ALTER TABLE "equipamentos" ADD CONSTRAINT "equipamento_recuperacao_nao_negativa_check"
  CHECK ("valor_recuperacao_estimado_centavos" IS NULL OR "valor_recuperacao_estimado_centavos" >= 0);

ALTER TABLE "movimentacoes" ALTER COLUMN "usuario_id" DROP NOT NULL;
ALTER TABLE "movimentacoes" ADD COLUMN "chave_api_id" UUID;

CREATE TABLE "chaves_api" (
    "id" UUID NOT NULL,
    "nome" VARCHAR(100) NOT NULL,
    "prefixo" VARCHAR(32) NOT NULL,
    "segredo_hash" VARCHAR(64) NOT NULL,
    "permissoes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "organizacao_id" UUID NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT TRUE,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revogada_em" TIMESTAMPTZ(3),
    CONSTRAINT "chaves_api_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chaves_api_permissoes_check" CHECK ("permissoes" <@ ARRAY['TRACE_READ', 'LOTS_READ', 'LOTS_WRITE', 'ANALYTICS_READ']::TEXT[])
);
CREATE UNIQUE INDEX "chaves_api_prefixo_key" ON "chaves_api"("prefixo");
CREATE INDEX "chaves_api_organizacao_id_ativa_idx" ON "chaves_api"("organizacao_id", "ativa");
ALTER TABLE "chaves_api" ADD CONSTRAINT "chaves_api_organizacao_id_fkey"
  FOREIGN KEY ("organizacao_id") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_chave_api_id_fkey"
  FOREIGN KEY ("chave_api_id") REFERENCES "chaves_api"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "movimentacoes" ADD CONSTRAINT "movimentacoes_ator_unico_check"
  CHECK (("usuario_id" IS NULL) <> ("chave_api_id" IS NULL));

CREATE TABLE "relatorios_analiticos" (
    "id" UUID NOT NULL,
    "tipo" "TipoRelatorioAnalitico" NOT NULL,
    "status" "StatusRelatorioAnalitico" NOT NULL DEFAULT 'PENDENTE',
    "organizacao_id" UUID NOT NULL,
    "chave_api_id" UUID,
    "solicitado_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "iniciado_em" TIMESTAMPTZ(3),
    "concluido_em" TIMESTAMPTZ(3),
    "resultado" JSONB,
    "erro" VARCHAR(500),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "versao" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "relatorios_analiticos_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "relatorios_analiticos_organizacao_id_solicitado_em_idx" ON "relatorios_analiticos"("organizacao_id", "solicitado_em");
CREATE INDEX "relatorios_analiticos_status_solicitado_em_idx" ON "relatorios_analiticos"("status", "solicitado_em");
ALTER TABLE "relatorios_analiticos" ADD CONSTRAINT "relatorios_analiticos_organizacao_id_fkey"
  FOREIGN KEY ("organizacao_id") REFERENCES "organizacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "relatorios_analiticos" ADD CONSTRAINT "relatorios_analiticos_chave_api_id_fkey"
  FOREIGN KEY ("chave_api_id") REFERENCES "chaves_api"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "observacoes_condicao" (
    "id" UUID NOT NULL,
    "equipamento_id" UUID NOT NULL,
    "idade_meses" DOUBLE PRECISION NOT NULL,
    "estado_fisico" "EstadoFisico" NOT NULL,
    "valor_contabil_centavos" INTEGER,
    "depreciacao_acumulada_centavos" INTEGER,
    "origem" "OrigemObservacaoCondicao" NOT NULL,
    "falha" BOOLEAN NOT NULL DEFAULT FALSE,
    "ocorrido_em" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "versao" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "observacoes_condicao_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "observacoes_condicao_valores_nao_negativos_check" CHECK (
      ("valor_contabil_centavos" IS NULL OR "valor_contabil_centavos" >= 0)
      AND ("depreciacao_acumulada_centavos" IS NULL OR "depreciacao_acumulada_centavos" >= 0)
    )
);
CREATE INDEX "observacoes_condicao_equipamento_id_idade_meses_idx" ON "observacoes_condicao"("equipamento_id", "idade_meses");
CREATE INDEX "observacoes_condicao_estado_fisico_ocorrido_em_idx" ON "observacoes_condicao"("estado_fisico", "ocorrido_em");
ALTER TABLE "observacoes_condicao" ADD CONSTRAINT "observacoes_condicao_equipamento_id_fkey"
  FOREIGN KEY ("equipamento_id") REFERENCES "equipamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
