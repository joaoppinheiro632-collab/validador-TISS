import { getTagVal, findLineNumber } from '../../utils/xml.js';

export default {
    id: "REG003",
    descricao: "Validar Datas de Execução fora do Período",

    executeProcedimento(procNode, context) {

        const dataInicioFat = getTagVal(context.guiaNode, 'dataInicioFaturamento');
        const horaInicioFat = getTagVal(context.guiaNode, 'horaInicioFaturamento') || '00:00:00';

        const dataFimFat = getTagVal(context.guiaNode, 'dataFinalFaturamento');
        const horaFimFat = getTagVal(context.guiaNode, 'horaFinalFaturamento') || '23:59:59';

        const dataExec = getTagVal(procNode, 'dataExecucao');
        const horaExec =
            getTagVal(procNode, 'horaInicial') ||
            getTagVal(procNode, 'horaFinal') ||
            '00:00:00';

        if (!dataInicioFat || !dataFimFat || !dataExec) {
            return;
        }

        const inicioFat = new Date(`${dataInicioFat}T${horaInicioFat}`);
        const fimFat = new Date(`${dataFimFat}T${horaFimFat}`);
        const execucao = new Date(`${dataExec}T${horaExec}`);

        if (
            isNaN(inicioFat.getTime()) ||
            isNaN(fimFat.getTime()) ||
            isNaN(execucao.getTime())
        ) {
            return;
        }

        if (execucao < inicioFat || execucao > fimFat) {

            const linhaData = findLineNumber(
                context.linesArray,
                'dataExecucao',
                context.procLinha - 1
            );

            context.results.erros.push({
                linha: linhaData,
                guia: context.identificadorGuia,
                item: context.seqItem,
                codigo: context.codProc,
                descricao: context.descProc,
                tipo: "Erro",
                categoria: "datas",
                mensagem: `Data/hora de execução (${dataExec} ${horaExec}) fora do período faturado.`,
                targetTag: "dataExecucao"
            });

            context.results.categorias.datas++;
        }
    }
};
