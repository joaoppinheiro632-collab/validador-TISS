// Resumo do Dia / Relatório de Produção.
//
// Dados 100% AUTOMÁTICOS, tirados do que o próprio PINWARE-TISS processou
// hoje (histórico de transmissões — já zera sozinho à meia-noite, então
// getHistorico() aqui já é "só hoje", sem precisar filtrar de novo). A
// tabela "Produção Realizada" é toda derivada disso, uma linha por
// prestador — nada de edição manual aqui, só a observação livre é do
// usuário.
const STORAGE_KEY_NOTA = 'pinware_relatorio_nota';
const STORAGE_KEY_NOTA_DIA = 'pinware_relatorio_nota_dia';

function getDiaAtual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Agrega o histórico de transmissões de hoje. Um mesmo lote pode ter sido
// baixado mais de uma vez (corrigiu e baixou de novo) — pra guias/valor/
// prestador, a versão mais recente é quem vale (reflete o lote como está
// agora). Mas pra "guiasComErro" isso seria errado: se o Validador pegou 1
// erro na primeira validação e o usuário corrigiu antes de baixar de novo,
// a versão mais recente já mostra 0 erros — e perderíamos o crédito do que
// foi prevenido. Por isso guiasComErro usa o PICO (maior valor já visto
// pra aquele lote hoje), não a última versão.
export function getResumoAutomatico(historico) {
    const porLote = new Map();
    historico.forEach(r => {
        const atual = porLote.get(r.lote);
        if (!atual) {
            porLote.set(r.lote, { ...r, guiasComErroPico: r.guiasComErro || 0 });
            return;
        }
        const maisRecente = r.dataHora > atual.dataHora ? r : atual;
        porLote.set(r.lote, {
            ...maisRecente,
            guiasComErroPico: Math.max(atual.guiasComErroPico, r.guiasComErro || 0)
        });
    });
    const registros = [...porLote.values()];

    const totalGuias = registros.reduce((acc, r) => acc + (r.guias || 0), 0);
    const totalGuiasComErro = registros.reduce((acc, r) => acc + (r.guiasComErroPico || 0), 0);
    const valorProduzido = registros.reduce((acc, r) => acc + (r.valor || 0), 0);
    const percentualPrevenido = totalGuias > 0
        ? Math.round((totalGuiasComErro / totalGuias) * 100)
        : 0;

    // Agrupamento por prestador — vira a base da tabela "Produção
    // Realizada", uma linha por prestador (código igual ao que já aparece
    // no Histórico de Transmissões), com quantidade de contas e valor.
    const porPrestadorMapa = new Map();
    registros.forEach(r => {
        const chave = r.prestador || 'N/I';
        const atual = porPrestadorMapa.get(chave) || { prestador: chave, quantidade: 0, valor: 0 };
        atual.quantidade += r.guias || 0;
        atual.valor += r.valor || 0;
        porPrestadorMapa.set(chave, atual);
    });

    return {
        registros,
        totalGuias,
        totalGuiasComErro,
        valorProduzido,
        percentualPrevenido,
        porPrestador: [...porPrestadorMapa.values()]
    };
}

function checarResetDiarioNota() {
    const diaSalvo = localStorage.getItem(STORAGE_KEY_NOTA_DIA);
    const diaAtual = getDiaAtual();
    if (diaSalvo !== diaAtual) {
        localStorage.removeItem(STORAGE_KEY_NOTA);
        localStorage.setItem(STORAGE_KEY_NOTA_DIA, diaAtual);
    }
}

export function getNotaDoDia() {
    checarResetDiarioNota();
    return localStorage.getItem(STORAGE_KEY_NOTA) || '';
}

export function salvarNotaDoDia(texto) {
    checarResetDiarioNota();
    localStorage.setItem(STORAGE_KEY_NOTA, texto || '');
}
