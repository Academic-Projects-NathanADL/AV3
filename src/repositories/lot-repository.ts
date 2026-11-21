import { Prisma, TipoMovimentacao, StatusEquipamento } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../shared/prisma";
import { registrarObservacaoCondicao } from "./condition-history";

type EquipmentInput = {
  tipo: Prisma.EquipamentoCreateInput["tipo"];
  estadoFisico: Prisma.EquipamentoCreateInput["estadoFisico"];
  marca?: string;
  modelo?: string;
  valorRecuperacaoEstimadoCentavos?: number;
  valorAquisicaoCentavos?: number;
  idadeMeses?: number;
};

function codigoRastreio(): string {
  const fragmento = randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  return `CV-${fragmento}`;
}

export class LotRepository {
  createWithEquipment(input: {
    codigoPublico: string;
    organizacaoId: string;
    notaFiscal: string;
    transportadora: string;
    dataEntrada: Date;
    equipamentos: EquipmentInput[];
    usuarioId?: string;
    chaveApiId?: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const lote = await tx.lote.create({
        data: {
          codigoPublico: input.codigoPublico,
          organizacaoId: input.organizacaoId,
          notaFiscal: input.notaFiscal,
          transportadora: input.transportadora,
          dataEntrada: input.dataEntrada,
        },
      });

      const equipamentos = [];
      for (const item of input.equipamentos) {
        const equipamento = await tx.equipamento.create({
          data: {
            codigoRastreio: codigoRastreio(), loteId: lote.id, tipo: item.tipo, estadoFisico: item.estadoFisico,
            ...(item.marca !== undefined ? { marca: item.marca } : {}),
            ...(item.modelo !== undefined ? { modelo: item.modelo } : {}),
            ...(item.valorRecuperacaoEstimadoCentavos !== undefined ? { valorRecuperacaoEstimadoCentavos: item.valorRecuperacaoEstimadoCentavos } : {}),
            ...(item.valorAquisicaoCentavos !== undefined && item.idadeMeses !== undefined
              ? { valorAquisicaoCentavos: item.valorAquisicaoCentavos, idadeMeses: item.idadeMeses }
              : {}),
          },
        });
        await registrarObservacaoCondicao(tx, equipamento, item.estadoFisico, equipamento.criadoEm, "RECEBIMENTO");
        await tx.movimentacao.create({
          data: {
            equipamentoId: equipamento.id,
            ...(input.usuarioId ? { usuarioId: input.usuarioId } : { chaveApiId: input.chaveApiId! }),
            tipo: TipoMovimentacao.ENTRADA,
            statusAnterior: null,
            statusNovo: StatusEquipamento.AGUARDANDO_TRIAGEM,
          },
        });
        equipamentos.push(equipamento);
      }
      return { ...lote, equipamentos };
    });
  }

  list() {
    return prisma.lote.findMany({
      include: { organizacao: { select: { id: true, razaoSocial: true, cnpj: true } }, _count: { select: { equipamentos: true } } },
      orderBy: { dataEntrada: "desc" },
    });
  }
}
