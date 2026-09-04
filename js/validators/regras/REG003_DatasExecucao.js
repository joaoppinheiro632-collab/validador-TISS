import { getTagVal, findLineNumber } from '../../utils/xml.js';
import { parseDate } from '../../utils/date.js';

export default {
    id: "REG003",
    descricao: "Validar Datas de Execução fora do Período",
    executeProcedimento(procNode, context) {
        const dtInicioFat = parseDate(getTagVal(context.guiaNode, 'dataInicioFaturamento'));
        const dtFimFat = parseDate(getTagVal(context.guiaNode, 'dataFinalFaturamento'));
        const dtExecStr = getTagVal(procNode, 'dataExecucao');
        const dtExec = parseDate(dtExecStr);

        if (dtExec && dtInicioFat && dtFimFat) {
            if (dtExec < dtInicioFat || dtExec > dtFimFat) {
                const linhaData = findLineNumber(context.linesArray, 'dataExecucao', context.procLinha - 1);
                context.results.erros.push({
                    linha: linhaData,
                    guia: context.identificadorGuia,
                    item: context.seqItem,
                    codigo: context.codProc,
                    descricao: context.descProc,
                    tipo: "Erro",
                    categoria: "datas",
                    mensagem: `Data de execução (${dtExecStr}) fora do período faturado.`,
                    targetTag: "dataExecucao"
                });
                context.results.categorias.datas++;
            }
        }
    }
};