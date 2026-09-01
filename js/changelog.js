// Log de alterações feitas no editor durante a sessão atual. Não persiste
// entre lotes nem entre recarregamentos da página — reinicia sempre que um
// novo arquivo é importado. Serve para auditoria manual ("o que eu mudei
// antes de baixar o lote"), não é um histórico de versões nem permite
// desfazer (isso o Ctrl+Z do próprio textarea já resolve).
let entries = [];
let idCounter = 0;

export function resetChangelog() {
    entries = [];
    idCounter = 0;
}

export function getChangelog() {
    return entries;
}

// Tenta reconhecer uma linha no formato "<tag>valor</tag>" (um tag por
// linha é como o XML TISS pretty-printed sempre aparece neste editor).
// Quando reconhece, dá pra apontar exatamente qual campo mudou em vez de
// só mostrar a linha crua.
function extrairCampoValor(linha) {
    const m = linha.match(/<(\w+)>([^<]*)<\/\1>/);
    if (!m) return null;
    return { campo: m[1], valor: m[2].trim() };
}

export function registrarAlteracoes(textoAntigo, textoNovo) {
    if (textoAntigo === textoNovo) return;

    const oldLines = textoAntigo.split(/\r\n|\r|\n/);
    const newLines = textoNovo.split(/\r\n|\r|\n/);

    // Alinha as duas versões pelas pontas: acha o maior prefixo e o maior
    // sufixo em comum, e trata só o trecho do meio como "o que mudou".
    // Isso cobre bem o caso comum (editar o valor de uma linha) sem precisar
    // de um algoritmo de diff completo.
    const limitePrefixo = Math.min(oldLines.length, newLines.length);
    let prefixo = 0;
    while (prefixo < limitePrefixo && oldLines[prefixo] === newLines[prefixo]) prefixo++;

    const limiteSufixo = Math.min(oldLines.length, newLines.length) - prefixo;
    let sufixo = 0;
    while (
        sufixo < limiteSufixo &&
        oldLines[oldLines.length - 1 - sufixo] === newLines[newLines.length - 1 - sufixo]
    ) sufixo++;

    const oldChanged = oldLines.slice(prefixo, oldLines.length - sufixo);
    const newChanged = newLines.slice(prefixo, newLines.length - sufixo);

    const agora = Date.now();

    if (oldChanged.length === newChanged.length && oldChanged.length > 0) {
        // Mesma quantidade de linhas nos dois lados: são edições linha a
        // linha, dá pra tentar identificar o campo alterado em cada uma.
        oldChanged.forEach((oldLine, i) => {
            const newLine = newChanged[i];
            if (oldLine === newLine) return;

            const linhaNum = prefixo + i + 1;
            const campoAntigo = extrairCampoValor(oldLine);
            const campoNovo = extrairCampoValor(newLine);

            let campo, antes, depois;
            if (campoAntigo && campoNovo && campoAntigo.campo === campoNovo.campo) {
                campo = campoAntigo.campo;
                antes = campoAntigo.valor || '(vazio)';
                depois = campoNovo.valor || '(vazio)';
            } else {
                campo = `Linha ${linhaNum}`;
                antes = oldLine.trim() || '(vazio)';
                depois = newLine.trim() || '(vazio)';
            }

            entries.unshift({
                id: `chg_${agora}_${idCounter++}`,
                dataHora: agora,
                linha: linhaNum,
                campo,
                antes,
                depois
            });
        });
    } else if (oldChanged.length || newChanged.length) {
        // Quantidade de linhas mudou (inseriu ou removeu um bloco/tag) —
        // registra um evento genérico em vez de tentar casar linha a linha,
        // o que aqui seria só uma adivinhação.
        entries.unshift({
            id: `chg_${agora}_${idCounter++}`,
            dataHora: agora,
            linha: prefixo + 1,
            campo: 'Estrutura do XML',
            antes: `${oldChanged.length} linha(s)`,
            depois: `${newChanged.length} linha(s)`
        });
    }
}
