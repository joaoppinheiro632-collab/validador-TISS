import REG001 from './regras/REG001_Senha.js';
import REG002 from './regras/REG002_DivergenciaGuia.js';
import REG003 from './regras/REG003_DatasExecucao.js';
import REG005 from './regras/REG005_CodigoIniciadoPorZero.js';
import REG007 from './regras/REG007_Financeiro.js';
import REG008 from './regras/REG008_MotivoEncerramentoTipoFaturamento.js';

import { getElementsByLocalName, getTagVal, findLineNumber } from '../utils/xml.js';
import { formatMoneyBR } from '../utils/format.js';

const regrasGuia = [REG001, REG002, REG008];
const regrasProcedimento = [REG003, REG005, REG007];

export function executeRuleEngine(xmlDoc, linesArray) {
    const results = {
        erros: [],
        alertas: [],
        guias: [],
        resumoLote: {},
        categorias: { fin: 0, datas: 0, estrut: 0 }
    };

    const guiasNodes = [
        ...getElementsByLocalName(xmlDoc, 'guiaResumoInternacao'),
        ...getElementsByLocalName(xmlDoc, 'guiaSP-SADT'),
        ...getElementsByLocalName(xmlDoc, 'guiaHonorarioIndividual')
    ];

    let somaTotalLoteCalculado = 0;

    // Cursor global usado para localizar a linha de cada guia. As guias são
    // processadas na mesma ordem em que aparecem no documento (DOMParser
    // preserva ordem), então buscar sempre a partir da última linha encontrada
    // (em vez de sempre do início do arquivo) evita casar com o identificador
    // de uma guia posterior que reaproveite o mesmo texto (ex: número de guia
    // referenciado em outro lugar do lote antes da guia real).
    let cursorGlobal = 0;

    guiasNodes.forEach((guiaNode, idx) => {
        const guiaInternacao = getTagVal(guiaNode, 'numeroGuiaSolicitacaoInternacao');
        const guiaOperadora = getTagVal(guiaNode, 'numeroGuiaOperadora');
        const guiaPrestador = getTagVal(guiaNode, 'numeroGuiaPrestador');

        const identificadorGuia = guiaInternacao || guiaOperadora || guiaPrestador || `SEM-NUMERO-${idx+1}`;
        const numLinhaGuia = findLineNumber(linesArray, identificadorGuia, cursorGlobal);
        cursorGlobal = numLinhaGuia;
        const senha = getTagVal(guiaNode, 'senha');

        let contextGuia = {
            guiaNode,
            identificadorGuia,
            numLinhaGuia,
            linesArray,
            results
        };

        // Executa regras em nível de Guia
        regrasGuia.forEach(regra => regra.execute(guiaNode, contextGuia));

        // Cursor local desta guia: avança a cada código encontrado, para que
        // itens com o mesmo código de procedimento repetido dentro da guia
        // casem cada um com a sua própria linha, em vez de todos apontarem
        // para a primeira ocorrência do código.
        let cursorProc = numLinhaGuia;

        // 1. Processa Procedimentos Executados
        const procedimentos = getElementsByLocalName(guiaNode, 'procedimentoExecutado');
        let somaProcedimentos = 0;

        procedimentos.forEach(proc => {
            const seqItem = getTagVal(proc, 'sequencialItem') || '-';
            const codProc = getTagVal(proc, 'codigoProcedimento') || '-';
            const descProc = getTagVal(proc, 'descricaoProcedimento') || 'Procedimento Sem Descrição';
            const valTotal = parseFloat(getTagVal(proc, 'valorTotal') || 0);
            const procLinha = findLineNumber(linesArray, codProc, cursorProc);
            cursorProc = procLinha;

            // Contexto passado por referência direta (sem spread) — regras que
            // mutam campos do contexto precisam ver o mesmo objeto, não uma cópia.
            const contextProc = contextGuia;
            contextProc.procNode = proc;
            contextProc.seqItem = seqItem;
            contextProc.codProc = codProc;
            contextProc.descProc = descProc;
            contextProc.procLinha = procLinha;
            contextProc.isDespesa = false; // Flag identificando procedimento cirúrgico/médico

            regrasProcedimento.forEach(regra => {
                if (regra.executeProcedimento) {
                    regra.executeProcedimento(proc, contextProc);
                }
            });

            somaProcedimentos += valTotal;
        });

        // 2. Processa Despesas / Medicamentos / Materiais / OPME
        const despesasNodes = getElementsByLocalName(guiaNode, 'despesa');
        let despesasCalc = { proc: somaProcedimentos, gases: 0, med: 0, mat: 0, dia: 0, tax: 0, opme: 0 };

        despesasNodes.forEach(desp => {
            const codDesp = getTagVal(desp, 'codigoDespesa');
            const servicos = getElementsByLocalName(desp, 'servicosExecutados');

            servicos.forEach(serv => {
                const seqItem = getTagVal(serv, 'sequencialItem') || '-';
                const codProc = getTagVal(serv, 'codigoProcedimento') || '-';
                const descProc = getTagVal(serv, 'descricaoProcedimento') || 'Despesa Sem Descrição';
                const valDesp = parseFloat(getTagVal(serv, 'valorTotal') || 0);
                const servLinha = findLineNumber(linesArray, codProc, cursorProc);
                cursorProc = servLinha;

                const contextDesp = contextGuia;
                contextDesp.procNode = serv;
                contextDesp.seqItem = seqItem;
                contextDesp.codProc = codProc;
                contextDesp.descProc = descProc;
                contextDesp.procLinha = servLinha;
                contextDesp.isDespesa = true; // Flag indicando que é despesa/material/OPME/medicamento

                // Aplica regras de item sobre as despesas
                regrasProcedimento.forEach(regra => {
                    if (regra.executeProcedimento) {
                        regra.executeProcedimento(serv, contextDesp);
                    }
                });

                // Soma o valor para auditoria por tipo de despesa
                switch(codDesp) {
                    case '01': despesasCalc.gases += valDesp; break;
                    case '02': despesasCalc.med += valDesp; break;
                    case '03': despesasCalc.mat += valDesp; break;
                    case '05': despesasCalc.dia += valDesp; break;
                    case '07': despesasCalc.tax += valDesp; break;
                    case '08': despesasCalc.opme += valDesp; break;
                }
            });
        });

        // O próximo cursor global de guia nunca pode retroceder para antes do
        // último item processado nesta guia.
        cursorGlobal = Math.max(cursorGlobal, cursorProc);

        const declarados = {
            proc: parseFloat(getTagVal(guiaNode, 'valorProcedimentos') || 0),
            mat: parseFloat(getTagVal(guiaNode, 'valorMateriais') || 0),
            med: parseFloat(getTagVal(guiaNode, 'valorMedicamentos') || 0),
            dia: parseFloat(getTagVal(guiaNode, 'valorDiarias') || 0),
            tax: parseFloat(getTagVal(guiaNode, 'valorTaxasAlugueis') || 0),
            opme: parseFloat(getTagVal(guiaNode, 'valorOPME') || 0),
            gas: parseFloat(getTagVal(guiaNode, 'valorGasesMedicinais') || 0),
            totalGeral: parseFloat(getTagVal(guiaNode, 'valorTotalGeral') || 0)
        };

        const somaCalculadaGuia = REG007.validarSomatoriosGuia(guiaNode, contextGuia, {
            proc: despesasCalc.proc,
            mat: despesasCalc.mat,
            med: despesasCalc.med,
            dia: despesasCalc.dia,
            tax: despesasCalc.tax,
            opme: despesasCalc.opme,
            gas: despesasCalc.gases
        }, declarados);

        somaTotalLoteCalculado += declarados.totalGeral;

        // Contadores por guia derivados diretamente de results.erros/alertas
        // (que já carregam o campo `guia`) em vez de propagados manualmente
        // através dos contextos — impossível dessincronizar, porque não há
        // mais um contador paralelo pra manter em dia.
        const errosGuia = results.erros.filter(e => e.guia === identificadorGuia).length;
        const alertasGuia = results.alertas.filter(a => a.guia === identificadorGuia).length;

        results.guias.push({
            guiaPrestador: identificadorGuia,
            senha: senha || 'S/N',
            linha: numLinhaGuia,
            valorTotal: declarados.totalGeral,
            valorCalculado: somaCalculadaGuia,
            erros: errosGuia,
            alertas: alertasGuia,
            detalhesValores: {
                proc: { dec: declarados.proc, calc: despesasCalc.proc },
                dia: { dec: declarados.dia, calc: despesasCalc.dia },
                tax: { dec: declarados.tax, calc: despesasCalc.tax },
                mat: { dec: declarados.mat, calc: despesasCalc.mat },
                med: { dec: declarados.med, calc: despesasCalc.med },
                opme: { dec: declarados.opme, calc: despesasCalc.opme },
                gas: { dec: declarados.gas, calc: despesasCalc.gases }
            }
        });
    });

    // O total do lote só é de fato "declarado" se existir uma tag própria no
    // XML pra isso (ex: valorTotalLote no cabeçalho/epílogo do lote). Antes,
    // esse campo recebia a mesma soma calculada — ou seja, o "Valor Total do
    // Lote" nunca era conferido contra nada real, só contra ele mesmo.
    const valorTotalLoteTag = getTagVal(xmlDoc, 'valorTotalLote');
    const valorTotalLoteInformado = valorTotalLoteTag !== '';
    const valorTotalLoteDeclarado = valorTotalLoteInformado ? parseFloat(valorTotalLoteTag) : null;

    if (valorTotalLoteInformado && Math.abs(valorTotalLoteDeclarado - somaTotalLoteCalculado) > 0.01) {
        results.erros.push({
            linha: findLineNumber(linesArray, 'valorTotalLote'),
            guia: "LOTE",
            item: "-",
            codigo: "-",
            descricao: "Resumo do Lote",
            tipo: "Erro",
            categoria: "fin",
            mensagem: `Divergência no valor total do lote: Declarado ${formatMoneyBR(valorTotalLoteDeclarado)} vs Calculado (soma das guias) ${formatMoneyBR(somaTotalLoteCalculado)}.`,
            targetTag: "valorTotalLote"
        });
        results.categorias.fin++;
    }

    results.resumoLote = {
        versao: getTagVal(xmlDoc, 'Padrao'),
        lote: getTagVal(xmlDoc, 'numeroLote'),
        prestador: getTagVal(xmlDoc, 'codigoPrestadorNaOperadora'),
        operadora: getTagVal(xmlDoc, 'registroANS') || getTagVal(xmlDoc, 'codigoOperadora') || 'N/I',
        // Exibido na sidebar: usa o valor declarado no XML quando existe,
        // senão cai para o calculado (e sinaliza isso via valorTotalLoteInformado).
        valorTotalLoteDeclarado: valorTotalLoteInformado ? valorTotalLoteDeclarado : somaTotalLoteCalculado,
        valorTotalLoteCalculado: somaTotalLoteCalculado,
        valorTotalLoteInformado
    };

    return results;
}