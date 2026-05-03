/**
 * ============================================================================
 *  kb.js — Knowledge Base (40 padrões espelhados do backend)
 *  ----------------------------------------------------------------------------
 *  Espelha CONFIG.KNOWLEDGE_BASE do Code.gs para matching offline no client.
 *  Cada padrão: { id, categoria, regex, titulo, severidade, solucao }
 *  ----------------------------------------------------------------------------
 *  API pública:
 *   - KB_PATTERNS        → array bruto (40 itens)
 *   - matchKB(text)      → primeiro padrão que casa, ou null
 *   - matchAllKB(text)   → todos os padrões que casam
 *   - findKBById(id)     → padrão pelo id, ou null
 *   - groupKBByCategoria → { sheets:[...], rede:[...], auth:[...], dados:[...], device:[...] }
 * ============================================================================
 */

export const KB_PATTERNS = [
  { id:'sh-001', categoria:'sheets', regex:/Service invoked too many times/i,         titulo:'Quota de execuções esgotada',       severidade:'ERRO',   solucao:'Implementar batch + cache; reduzir frequência de gravações.' },
  { id:'sh-002', categoria:'sheets', regex:/Exceeded maximum execution time/i,        titulo:'Timeout 6 min do Apps Script',      severidade:'ERRO',   solucao:'Quebrar em chunks via PropertiesService + trigger.' },
  { id:'sh-003', categoria:'sheets', regex:/limit.*cells|10.?000.?000/i,              titulo:'Limite de 10M células atingido',    severidade:'ERRO',   solucao:'Migrar dados frios; arquivar abas antigas.' },
  { id:'sh-004', categoria:'sheets', regex:/Range not found|aba não encontrada/i,     titulo:'Range/aba não encontrada',          severidade:'ALERTA', solucao:'Verificar nomes via getSheetByName antes de getRange.' },
  { id:'sh-005', categoria:'sheets', regex:/getValue.*null|getValues.*null/i,         titulo:'Leitura de célula vazia',           severidade:'INFO',   solucao:'Validar com getLastRow/Column antes de ler.' },
  { id:'sh-006', categoria:'sheets', regex:/Lock timeout|waitLock/i,                  titulo:'LockService travado',               severidade:'ALERTA', solucao:'Reduzir tempo crítico; usar tryLock(0) com retry.' },
  { id:'sh-007', categoria:'sheets', regex:/too large|payload exceeded/i,             titulo:'Payload de escrita > 50MB',         severidade:'ERRO',   solucao:'Quebrar setValues em blocos de 5k linhas.' },
  { id:'sh-008', categoria:'sheets', regex:/do not have permission|access denied/i,   titulo:'Permissão de planilha revogada',    severidade:'ERRO',   solucao:'Reautorizar conta de serviço; validar OAuth scopes.' },
  { id:'sh-009', categoria:'sheets', regex:/Document.*deleted|file not found/i,       titulo:'Documento excluído',                severidade:'ERRO',   solucao:'Restaurar do Drive Trash em até 30d.' },
  { id:'sh-010', categoria:'sheets', regex:/Authorization is required/i,              titulo:'Token expirado',                    severidade:'ERRO',   solucao:'Forçar reLogin; renovar refresh_token.' },
  { id:'nw-001', categoria:'rede',   regex:/DNS|getaddrinfo|ENOTFOUND/i,              titulo:'Falha de DNS',                      severidade:'ERRO',   solucao:'Verificar conectividade e DNS.' },
  { id:'nw-002', categoria:'rede',   regex:/ECONNREFUSED|connection refused/i,        titulo:'Conexão recusada',                  severidade:'ERRO',   solucao:'Endpoint offline; ativar fallback.' },
  { id:'nw-003', categoria:'rede',   regex:/ETIMEDOUT|timeout|timed out/i,            titulo:'Timeout de fetch',                  severidade:'ALERTA', solucao:'Aumentar timeout ou usar circuit breaker.' },
  { id:'nw-004', categoria:'rede',   regex:/CORS|Access-Control-Allow/i,              titulo:'CORS bloqueado',                    severidade:'ERRO',   solucao:'Configurar Access-Control-Allow-Origin no servidor.' },
  { id:'nw-005', categoria:'rede',   regex:/SSL|certificate|TLS/i,                    titulo:'Certificado SSL inválido',          severidade:'ERRO',   solucao:'Renovar TLS; conferir cadeia.' },
  { id:'nw-006', categoria:'rede',   regex:/429|Too Many Requests|rate limit/i,       titulo:'Rate limit',                        severidade:'ALERTA', solucao:'Backoff exponencial + jitter.' },
  { id:'nw-007', categoria:'rede',   regex:/502|503|504|gateway/i,                    titulo:'Gateway/upstream',                  severidade:'ALERTA', solucao:'Retry com circuit breaker.' },
  { id:'nw-008', categoria:'rede',   regex:/NetworkError|Failed to fetch/i,           titulo:'Falha de rede no client',           severidade:'ALERTA', solucao:'Detectar offline + retry on visibility.' },
  { id:'au-001', categoria:'auth',   regex:/invalid_grant|token revoked/i,            titulo:'Token revogado',                    severidade:'ERRO',   solucao:'Forçar reautenticação OAuth.' },
  { id:'au-002', categoria:'auth',   regex:/401|Unauthorized/i,                       titulo:'Sem credenciais válidas',           severidade:'ERRO',   solucao:'Renovar API key/token.' },
  { id:'au-003', categoria:'auth',   regex:/403|Forbidden/i,                          titulo:'Permissão negada',                  severidade:'ERRO',   solucao:'Verificar roles do usuário.' },
  { id:'au-004', categoria:'auth',   regex:/session.*expired|sess(a|ã)o.*expirad/i,   titulo:'Sessão expirada',                   severidade:'INFO',   solucao:'Comportamento esperado após 90s sem heartbeat.' },
  { id:'au-005', categoria:'auth',   regex:/wrong password|senha incorreta/i,         titulo:'Login falho',                       severidade:'ALERTA', solucao:'Bloquear após 5 tentativas em 10min.' },
  { id:'au-006', categoria:'auth',   regex:/2FA|two-factor|TOTP/i,                    titulo:'2FA pendente',                      severidade:'INFO',   solucao:'Aguardar código TOTP do usuário.' },
  { id:'dt-001', categoria:'dados',  regex:/undefined is not|Cannot read prop/i,      titulo:'Acesso a undefined',                severidade:'ERRO',   solucao:'Optional chaining + default values.' },
  { id:'dt-002', categoria:'dados',  regex:/NaN|Invalid Number/i,                     titulo:'Conversão numérica falha',          severidade:'ALERTA', solucao:'Number(x) com isFinite() check.' },
  { id:'dt-003', categoria:'dados',  regex:/Invalid Date/i,                           titulo:'Data inválida',                     severidade:'ALERTA', solucao:'ISO-8601 obrigatório; validar antes de new Date().' },
  { id:'dt-004', categoria:'dados',  regex:/JSON.parse|Unexpected token/i,            titulo:'JSON malformado',                   severidade:'ERRO',   solucao:'try/catch + logar primeiros 200 chars.' },
  { id:'dt-005', categoria:'dados',  regex:/duplicate.*key|UNIQUE constraint/i,       titulo:'Chave duplicada',                   severidade:'ALERTA', solucao:'Upsert em vez de insert.' },
  { id:'dt-006', categoria:'dados',  regex:/foreign key|FK constraint/i,              titulo:'FK órfã',                           severidade:'ALERTA', solucao:'Cascata ou validação prévia.' },
  { id:'dt-007', categoria:'dados',  regex:/string.*too long|too long for type/i,     titulo:'String estourou limite',            severidade:'INFO',   solucao:'Truncar antes de gravar (slice).' },
  { id:'dt-008', categoria:'dados',  regex:/required.*missing|campo obrigat/i,        titulo:'Campo obrigatório ausente',         severidade:'ALERTA', solucao:'Validar payload no client + server.' },
  { id:'rt-001', categoria:'device', regex:/out of memory|allocation failed|OOM/i,    titulo:'Out Of Memory',                     severidade:'ERRO',   solucao:'Streamar dados; paginar; liberar refs.' },
  { id:'rt-002', categoria:'device', regex:/storage.*full|QuotaExceededError/i,       titulo:'localStorage cheio',                severidade:'ALERTA', solucao:'Purgar caches antigos; usar IndexedDB.' },
  { id:'rt-003', categoria:'device', regex:/IndexedDB|IDB.*error/i,                   titulo:'IndexedDB falhou',                  severidade:'ALERTA', solucao:'Fallback para memória; alertar usuário.' },
  { id:'rt-004', categoria:'device', regex:/ServiceWorker|sw\.js/i,                   titulo:'Service Worker erro',               severidade:'INFO',   solucao:'Limpar cache do SW; reinstalar.' },
  { id:'rt-005', categoria:'device', regex:/GPU.*lost|WebGL context/i,                titulo:'Contexto GPU perdido',              severidade:'ALERTA', solucao:'Reinicializar canvas; degradar para 2D.' },
  { id:'rt-006', categoria:'device', regex:/battery|low power/i,                      titulo:'Modo baixa energia',                severidade:'INFO',   solucao:'Reduzir polling; pausar animações.' },
  { id:'rt-007', categoria:'device', regex:/permission.*camera|microphone|geo/i,      titulo:'Permissão de mídia negada',         severidade:'ALERTA', solucao:'Solicitar via gesto do usuário; explicar uso.' },
  { id:'rt-008', categoria:'device', regex:/Maximum call stack|stack overflow/i,      titulo:'Stack overflow',                    severidade:'ERRO',   solucao:'Trocar recursão por iteração; checar caso-base.' }
];

/**
 * Retorna o primeiro padrão que casa com o texto, ou null.
 * @param {string} text
 * @returns {object|null}
 */
export function matchKB(text) {
  if (!text) return null;
  const s = String(text);
  for (const p of KB_PATTERNS) {
    if (p.regex.test(s)) return p;
  }
  return null;
}

/**
 * Retorna TODOS os padrões que casam com o texto.
 * Útil pra erros que disparam múltiplas categorias (ex: timeout + rate limit).
 * @param {string} text
 * @returns {object[]}
 */
export function matchAllKB(text) {
  if (!text) return [];
  const s = String(text);
  const matches = [];
  for (const p of KB_PATTERNS) {
    if (p.regex.test(s)) matches.push(p);
  }
  return matches;
}

/**
 * Busca padrão pelo id (ex: 'sh-001').
 * @param {string} id
 * @returns {object|null}
 */
export function findKBById(id) {
  if (!id) return null;
  return KB_PATTERNS.find(p => p.id === String(id).toLowerCase()) || null;
}

/**
 * Agrupa padrões por categoria. Útil pra UI de explorar a Knowledge Base.
 * @returns {Object<string, object[]>}
 */
export function groupKBByCategoria() {
  const groups = {};
  for (const p of KB_PATTERNS) {
    if (!groups[p.categoria]) groups[p.categoria] = [];
    groups[p.categoria].push(p);
  }
  return groups;
}
