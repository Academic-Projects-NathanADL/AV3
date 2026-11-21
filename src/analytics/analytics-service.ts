import { EstadoFisico, TipoMovimentacao } from "@prisma/client";
import { prisma } from "../shared/prisma";

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const estadoScore: Record<EstadoFisico, number> = {
  EXCELENTE: 0, BOM: 1, REGULAR: 2, RUIM: 3, INSERVIVEL: 4,
};

export class AnalyticsService {
  async eficienciaOperacional(organizacaoId: string) {
    const events = await prisma.movimentacao.findMany({
      where: { tipo: TipoMovimentacao.TRIAGEM, statusNovo: "TRIADO" },
      include: {
        equipamento: { include: { lote: { select: { organizacaoId: true, dataEntrada: true } } } },
        usuario: { select: { login: true } },
        chaveApi: { select: { nome: true } },
      },
      orderBy: { ocorridoEm: "asc" },
    });
    const seen = new Set<string>();
    const completed = events.filter((event) => {
      if (event.equipamento.lote.organizacaoId !== organizacaoId || seen.has(event.equipamentoId)) return false;
      seen.add(event.equipamentoId);
      return event.ocorridoEm >= event.equipamento.lote.dataEntrada;
    }).map((event) => ({
      equipamentoId: event.equipamentoId,
      operador: event.usuario?.login ?? event.chaveApi?.nome ?? "integracao-publica",
      mes: event.ocorridoEm.toISOString().slice(0, 7),
      horas: (event.ocorridoEm.getTime() - event.equipamento.lote.dataEntrada.getTime()) / 3_600_000,
    }));

    const average = (items: Array<{ horas: number }>) => items.length ? round(items.reduce((sum, item) => sum + item.horas, 0) / items.length) : null;
    const group = (field: "operador" | "mes") => {
      const buckets = new Map<string, Array<{ horas: number }>>();
      for (const item of completed) buckets.set(item[field], [...(buckets.get(item[field]) ?? []), item]);
      return [...buckets.entries()].map(([chave, values]) => ({ chave, lotesEquipamentoTriados: values.length, mediaHoras: average(values) })).sort((a, b) => a.chave.localeCompare(b.chave));
    };
    return {
      equipamentoTriados: completed.length,
      mediaHorasEntradaAteTriagem: average(completed),
      porOperador: group("operador"),
      porMesTriagem: group("mes"),
      criterio: "Tempo entre data de entrada do lote e primeira movimentacao de triagem concluida do equipamento.",
    };
  }

  async rentabilidadePorEquipamento(organizacaoId: string) {
    const items = await prisma.equipamento.findMany({
      where: { lote: { is: { organizacaoId } }, valorRecuperacaoEstimadoCentavos: { not: null } },
      select: { tipo: true, estadoFisico: true, marca: true, modelo: true, valorRecuperacaoEstimadoCentavos: true },
    });
    const groups = new Map<string, { tipo: string; estadoFisico: string; marca: string; modelo: string; valores: number[] }>();
    for (const item of items) {
      const marca = item.marca ?? "SEM_MARCA";
      const modelo = item.modelo ?? "SEM_MODELO";
      const key = [item.tipo, item.estadoFisico, marca, modelo].join("|");
      const current = groups.get(key) ?? { tipo: item.tipo, estadoFisico: item.estadoFisico, marca, modelo, valores: [] };
      current.valores.push(item.valorRecuperacaoEstimadoCentavos!);
      groups.set(key, current);
    }
    const porGrupo = [...groups.values()].map((group) => ({
      tipo: group.tipo,
      estadoFisico: group.estadoFisico,
      marca: group.marca,
      modelo: group.modelo,
      amostras: group.valores.length,
      mediaRecuperacaoCentavos: Math.round(group.valores.reduce((sum, value) => sum + value, 0) / group.valores.length),
      totalEstimadoCentavos: group.valores.reduce((sum, value) => sum + value, 0),
    })).sort((a, b) => b.mediaRecuperacaoCentavos - a.mediaRecuperacaoCentavos);
    return {
      equipamentosComEstimativa: items.length,
      mediaRecuperacaoCentavos: items.length ? Math.round(items.reduce((sum, item) => sum + item.valorRecuperacaoEstimadoCentavos!, 0) / items.length) : null,
      porTipoEstadoMarcaModelo: porGrupo,
      criterio: "Valores estimados informados no recebimento; agrupamento por tipo, condicao fisica, marca e modelo.",
    };
  }

  async vidaUtilRemanescente(organizacaoId: string) {
    const observations = await prisma.observacaoCondicao.findMany({
      where: { equipamento: { is: { lote: { is: { organizacaoId } } } } },
      include: { equipamento: { select: { id: true, tipo: true, valorAquisicaoCentavos: true } } },
      orderBy: { idadeMeses: "asc" },
    });
    type Point = { age: number; state: number; depreciationRatio: number | null; equipmentId: string; failure: boolean };
    const grouped = new Map<string, Point[]>();
    for (const observation of observations) {
      const acquisition = observation.equipamento.valorAquisicaoCentavos;
      const depreciationRatio = acquisition && observation.depreciacaoAcumuladaCentavos !== null
        ? observation.depreciacaoAcumuladaCentavos / acquisition
        : null;
      const points = grouped.get(observation.equipamento.tipo) ?? [];
      points.push({ age: observation.idadeMeses, state: estadoScore[observation.estadoFisico], depreciationRatio, equipmentId: observation.equipamento.id, failure: observation.falha });
      grouped.set(observation.equipamento.tipo, points);
    }
    const regress = (points: Array<{ x: number; y: number }>) => {
      if (!points.length) return { slope: 0, intercept: 0, r2: 0 };
      const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
      const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
      const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
      const slope = denominator > 0 ? points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0) / denominator : 0;
      const intercept = meanY - slope * meanX;
      const total = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0);
      const residual = points.reduce((sum, point) => sum + (point.y - (intercept + slope * point.x)) ** 2, 0);
      return { slope, intercept, r2: total > 0 ? Math.max(0, 1 - residual / total) : 0 };
    };

    const previsoes = [...grouped.entries()].map(([tipo, points]) => {
      const latestAgeByEquipment = new Map<string, number>();
      for (const point of points) latestAgeByEquipment.set(point.equipmentId, Math.max(latestAgeByEquipment.get(point.equipmentId) ?? 0, point.age));
      const averageCurrentAge = [...latestAgeByEquipment.values()].reduce((sum, age) => sum + age, 0) / Math.max(latestAgeByEquipment.size, 1);
      const byAge = regress(points.map((point) => ({ x: point.age, y: point.state })));
      const depreciationPoints = points.filter((point): point is Point & { depreciationRatio: number } => point.depreciationRatio !== null);
      const byDepreciation = regress(depreciationPoints.map((point) => ({ x: point.depreciationRatio, y: point.state })));
      const ageByDepreciation = regress(depreciationPoints.map((point) => ({ x: point.age, y: point.depreciationRatio })));
      const depreciationUsable = depreciationPoints.length >= 3
        && new Set(depreciationPoints.map((point) => point.equipmentId)).size >= 2
        && byDepreciation.slope > 0 && ageByDepreciation.slope > 0;
      const ageUsable = points.length >= 3 && new Set(points.map((point) => point.equipmentId)).size >= 2 && byAge.slope > 0;
      let ageAtFailure: number | null = null;
      let remaining: number | null = null;
      let method = "DADOS_INSUFICIENTES";
      if (depreciationUsable) {
        const failureDepreciation = (estadoScore.INSERVIVEL - byDepreciation.intercept) / byDepreciation.slope;
        ageAtFailure = (failureDepreciation - ageByDepreciation.intercept) / ageByDepreciation.slope;
        remaining = Math.max(0, ageAtFailure - averageCurrentAge);
        method = "DEPRECIACAO_E_DEGRADACAO";
      } else if (ageUsable) {
        ageAtFailure = (estadoScore.INSERVIVEL - byAge.intercept) / byAge.slope;
        remaining = Math.max(0, ageAtFailure - averageCurrentAge);
        method = "IDADE_E_DEGRADACAO";
      }
      const averageDepreciationBps = depreciationPoints.length
        ? round(depreciationPoints.reduce((sum, point) => sum + point.depreciationRatio * 10_000, 0) / depreciationPoints.length, 0)
        : null;
      return {
        tipo,
        equipamentosObservados: new Set(points.map((point) => point.equipmentId)).size,
        observacoesHistoricas: points.length,
        observacoesComDepreciacao: depreciationPoints.length,
        eventosDeFalhaOuPioraFisica: points.filter((point) => point.failure).length,
        depreciacaoAcumuladaMediaBps: averageDepreciationBps,
        r2DesgastePorIdade: round(byAge.r2, 4),
        r2DesgastePorDepreciacao: depreciationUsable ? round(byDepreciation.r2, 4) : null,
        idadeProjetadaAoAtingirInservivelMeses: ageAtFailure === null ? null : round(ageAtFailure),
        vidaUtilRemanescenteMediaMeses: remaining === null ? null : round(remaining),
        metodo: method,
      };
    }).sort((a, b) => a.tipo.localeCompare(b.tipo));
    return {
      metodo: "Regressao linear por minimos quadrados ordinarios entre estado fisico, idade e depreciacao acumulada observados; pioras de condicao sao registradas como eventos de falha.",
      previsoes,
      limitacao: "Estimativa exploratoria; precisa de observacoes repetidas e valores de aquisicao. R2, amostra e eventos de falha acompanham cada previsao.",
    };
  }

  async pacoteCompleto(organizacaoId: string) {
    const organization = await prisma.organizacao.findUnique({ where: { id: organizacaoId }, select: { id: true, razaoSocial: true } });
    if (!organization) throw new Error("Organizacao do relatorio nao encontrada.");
    const [eficienciaOperacional, rentabilidadePorEquipamento, vidaUtilRemanescente] = await Promise.all([
      this.eficienciaOperacional(organizacaoId),
      this.rentabilidadePorEquipamento(organizacaoId),
      this.vidaUtilRemanescente(organizacaoId),
    ]);
    return { geradoEm: new Date().toISOString(), organizacao: organization, eficienciaOperacional, rentabilidadePorEquipamento, vidaUtilRemanescente };
  }
}
