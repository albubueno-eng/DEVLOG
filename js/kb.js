/**
 * ============================================================================
 * kb.js — Knowledge Base local (mirror das 40 regras do backend)
 * ----------------------------------------------------------------------------
 * Por que duplicar no front?
 *   - Evita 1 round-trip por log (matching instantâneo).
 *   - Permite destacar visualmente cards com sugestão sem esperar o backend.
 *   - Backend continua sendo a fonte oficial via action 'knowledge' quando
 *     precisarmos de match confirmado/cacheado.
 *
 * Mantenha estas regras SINCRONIZADAS com KNOWLEDGE_BASE em Code.gs.
 * ============================================================================
 */

/* ----------------------------------------------------------------------------
 * Severidades canônicas (espelha SEVERIDADES de config.js)
 * ------------------------------------------------------------------------- */
const SEV = Object.freeze({
  ERRO: 'erro',
  ALERTA: 'alerta',
  INFO: 'info',
});

/* ----------------------------------------------------------------------------
 * Knowledge Base — 40 padrões
 * ------------------------------------------------------------------------- */
export const KNOWLEDGE_BASE = Object.freeze([
  { id:'KB001', regex:/timeout/i, categoria:'rede', severidade:SEV.ALERTA,
    titulo:'Timeout detectado', solucao:'Verifique conectividade e aumente timeout do fetch.' },
  { id:'KB002', regex:/permission denied|sem permiss/i, categoria:'permissao', severidade:SEV.ERRO,
    titulo:'Permissão negada', solucao:'Confirme escopos OAuth e ACL da planilha.' },
  { id:'KB003', regex:/quota|limit exceeded/i, categoria:'quota', severidade:SEV.ERRO,
    titulo:'Quota Google atingida', solucao:'Aguarde reset diário ou particione execuções.' },
  { id:'KB004', regex:/script function not found/i, categoria:'codigo', severidade:SEV.ERRO,
    titulo:'Função não encontrada', solucao:'Verifique nome da função e deploy ativo.' },
  { id:'KB005', regex:/range not found|intervalo/i, categoria:'planilha', severidade:SEV.ALERTA,
    titulo:'Range inexistente', solucao:'Cheque nomes de abas/intervalos nomeados.' },
  { id:'KB006', regex:/exceeded maximum execution time/i, categoria:'performance', severidade:SEV.ERRO,
    titulo:'Timeout de 6 min', solucao:'Quebre em batches ou use trigger de continuação.' },
  { id:'KB007', regex:/cannot read propert(y|ies)/i, categoria:'codigo', severidade:SEV.ERRO,
    titulo:'Null/undefined', solucao:'Adicione checagem defensiva antes de acessar propriedade.' },
  { id:'KB008', regex:/network error|failed to fetch/i, categoria:'rede', severidade:SEV.ALERTA,
    titulo:'Falha de rede', solucao:'Implemente retry com backoff exponencial.' },
  { id:'KB009', regex:/invalid argument/i, categoria:'codigo', severidade:SEV.ALERTA,
    titulo:'Argumento inválido', solucao:'Valide tipos antes de chamar a API.' },
  { id:'KB010', regex:/service spreadsheets failed/i, categoria:'planilha', severidade:SEV.ERRO,
    titulo:'Falha do serviço Sheets', solucao:'Retry com SpreadsheetApp.flush() ou Lock.' },
  { id:'KB011', regex:/lock timeout|could not obtain lock/i, categoria:'concorrencia', severidade:SEV.ALERTA,
    titulo:'Lock não obtido', solucao:'Aumente waitLock e reduza região crítica.' },
  { id:'KB012', regex:/json|unexpected token/i, categoria:'parsing', severidade:SEV.ERRO,
    titulo:'JSON inválido', solucao:'Use try/catch no JSON.parse e valide payload.' },
  { id:'KB013', regex:/cors/i, categoria:'rede', severidade:SEV.ERRO,
    titulo:'Erro CORS', solucao:'Confirme deploy "qualquer pessoa" e use POST text/plain.' },
  { id:'KB014', regex:/401|unauthorized/i, categoria:'auth', severidade:SEV.ERRO,
    titulo:'Não autorizado', solucao:'Renove token / valide API_KEY.' },
  { id:'KB015', regex:/403|forbidden/i, categoria:'auth', severidade:SEV.ERRO,
    titulo:'Acesso proibido', solucao:'Revise permissões do recurso.' },
  { id:'KB016', regex:/404|not found/i, categoria:'rota', severidade:SEV.ALERTA,
    titulo:'Recurso não encontrado', solucao:'Cheque URL/ID do recurso.' },
  { id:'KB017', regex:/500|internal server/i, categoria:'servidor', severidade:SEV.ERRO,
    titulo:'Erro interno do servidor', solucao:'Veja stack e retry; logs Apps Script.' },
  { id:'KB018', regex:/maximum call stack/i, categoria:'codigo', severidade:SEV.ERRO,
    titulo:'Recursão infinita', solucao:'Adicione condição de saída ou itere.' },
  { id:'KB019', regex:/storage quota|disk full/i, categoria:'quota', severidade:SEV.ERRO,
    titulo:'Storage cheio', solucao:'Limpe Drive ou aumente plano.' },
  { id:'KB020', regex:/duplicate entry|unique constraint/i, categoria:'dados', severidade:SEV.ALERTA,
    titulo:'Registro duplicado', solucao:'Cheque chave única antes de inserir.' },
  { id:'KB021', regex:/heartbeat/i, categoria:'sessao', severidade:SEV.INFO,
    titulo:'Heartbeat OK', solucao:'Sem ação — apenas keep-alive.' },
  { id:'KB022', regex:/login (success|sucesso)/i, categoria:'auth', severidade:SEV.INFO,
    titulo:'Login com sucesso', solucao:'Sem ação.' },
  { id:'KB023', regex:/login (fail|falh)/i, categoria:'auth', severidade:SEV.ALERTA,
    titulo:'Falha de login', solucao:'Verifique credenciais e bloqueio por tentativas.' },
  { id:'KB024', regex:/script approaching/i, categoria:'performance', severidade:SEV.ALERTA,
    titulo:'Aproximando do limite de execução', solucao:'Otimize loops e batches.' },
  { id:'KB025', regex:/cache.*miss|cache miss/i, categoria:'cache', severidade:SEV.INFO,
    titulo:'Cache miss', solucao:'Sem ação se ocasional; aumente TTL se frequente.' },
  { id:'KB026', regex:/trigger.*disabled|trigger desabilitad/i, categoria:'trigger', severidade:SEV.ERRO,
    titulo:'Trigger desabilitado', solucao:'Reinstale via instalarTriggerCapacity().' },
  { id:'KB027', regex:/cell.*invalid/i, categoria:'planilha', severidade:SEV.ALERTA,
    titulo:'Célula inválida', solucao:'Valide range antes do setValue.' },
  { id:'KB028', regex:/url fetch.*denied/i, categoria:'rede', severidade:SEV.ERRO,
    titulo:'UrlFetch negado', solucao:'Adicione domínio em whitelist do Apps Script.' },
  { id:'KB029', regex:/utc|timezone/i, categoria:'data', severidade:SEV.INFO,
    titulo:'Diferença de fuso', solucao:'Use Utilities.formatDate com TZ explícito.' },
  { id:'KB030', regex:/(undefined|null) is not (a function|an object)/i, categoria:'codigo', severidade:SEV.ERRO,
    titulo:'Função/objeto inexistente', solucao:'Verifique import/escopo.' },
  { id:'KB031', regex:/concurrent edit/i, categoria:'concorrencia', severidade:SEV.ALERTA,
    titulo:'Edição concorrente', solucao:'Use LockService antes de escrever.' },
  { id:'KB032', regex:/event.*duplicate/i, categoria:'dados', severidade:SEV.INFO,
    titulo:'Evento duplicado', solucao:'Idempotência via hashDedupe.' },
  { id:'KB033', regex:/sheet.*hidden/i, categoria:'planilha', severidade:SEV.INFO,
    titulo:'Aba oculta', solucao:'Sem ação se intencional.' },
  { id:'KB034', regex:/version mismatch/i, categoria:'deploy', severidade:SEV.ALERTA,
    titulo:'Versão divergente', solucao:'Atualize cliente para versão atual do deploy.' },
  { id:'KB035', regex:/manifest|appsscript\.json/i, categoria:'manifesto', severidade:SEV.ERRO,
    titulo:'Erro de manifesto', solucao:'Cheque appsscript.json e escopos.' },
  { id:'KB036', regex:/disconnect|websocket closed/i, categoria:'rede', severidade:SEV.ALERTA,
    titulo:'Desconexão', solucao:'Implemente reconnect com backoff.' },
  { id:'KB037', regex:/parse error/i, categoria:'parsing', severidade:SEV.ERRO,
    titulo:'Erro de parsing', solucao:'Valide schema do payload.' },
  { id:'KB038', regex:/rate limit/i, categoria:'quota', severidade:SEV.ALERTA,
    titulo:'Rate limit', solucao:'Reduza frequência ou implemente fila.' },
  { id:'KB039', regex:/insufficient permissions/i, categoria:'permissao', severidade:SEV.ERRO,
    titulo:'Permissões insuficientes', solucao:'Solicite reautorização do escopo.' },
  { id:'KB040', regex:/undefined symbol|reference error/i, categoria:'codigo', severidade:SEV.ERRO,
    titulo:'Símbolo indefinido', solucao:'Confirme declaração antes do uso.' },
]);

/* ----------------------------------------------------------------------------
 * matchKB — retorna a 1ª regra que casa com a mensagem (ou null)
 * ------------------------------------------------------------------------- */
export function matchKB(mensagem) {
  if (!mensagem) return null;
  const txt = String(mensagem);
  for (let i = 0; i < KNOWLEDGE_BASE.length; i++) {
    if (KNOWLEDGE_BASE[i].regex.test(txt)) {
      return KNOWLEDGE_BASE[i];
    }
  }
  return null;
}

/* ----------------------------------------------------------------------------
 * matchAllKB — retorna TODAS as regras que casam (útil para auditoria)
 * ------------------------------------------------------------------------- */
export function matchAllKB(mensagem) {
  if (!mensagem) return [];
  const txt = String(mensagem);
  return KNOWLEDGE_BASE.filter(kb => kb.regex.test(txt));
}

/* ----------------------------------------------------------------------------
 * findKBById — busca por id (usado quando o backend retorna um match)
 * ------------------------------------------------------------------------- */
export function findKBById(id) {
  if (!id) return null;
  return KNOWLEDGE_BASE.find(k => k.id === String(id)) || null;
}

/* ----------------------------------------------------------------------------
 * groupKBByCategoria — útil para listar a base inteira agrupada
 * ------------------------------------------------------------------------- */
export function groupKBByCategoria() {
  const grupos = {};
  KNOWLEDGE_BASE.forEach(kb => {
    if (!grupos[kb.categoria]) grupos[kb.categoria] = [];
    grupos[kb.categoria].push(kb);
  });
  return grupos;
}
