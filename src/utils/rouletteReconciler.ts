export interface ReconcileSpinsResult {
  nextSession: number[];
  nextBackup: number[];
}

export function reconcileScannerSpins(
  prevSession: number[],
  prevBackup: number[],
  incoming: number[],
  isFullStrip: boolean
): ReconcileSpinsResult {
  if (incoming.length === 0) {
    return { nextSession: prevSession, nextBackup: prevBackup };
  }

  if (!isFullStrip) {
    // Novos giros em tempo real: entram na sessão atual para avaliar OK/X + %
    return {
      nextSession: [...incoming, ...prevSession].slice(0, 500),
      nextBackup: prevBackup,
    };
  }

  // Faixa completa detectada ao abrir mesa ou trocar de mesa:
  // Verifica se já está alinhada com o histórico atual (sessão + backup)
  const combined = [...prevSession, ...prevBackup];
  if (combined.length >= 3 && incoming.length >= 3) {
    // 1. Alinhamento exato em janela de 3 números
    for (let shift = 0; shift <= Math.min(5, incoming.length - 3); shift++) {
      if (
        incoming[shift] === combined[0] &&
        incoming[shift + 1] === combined[1] &&
        incoming[shift + 2] === combined[2]
      ) {
        if (shift === 0) {
          return { nextSession: prevSession, nextBackup: prevBackup };
        }
        return {
          nextSession: [...incoming.slice(0, shift), ...prevSession].slice(0, 500),
          nextBackup: prevBackup,
        };
      }
    }

    // 2. Alinhamento tolerante (3 em 4) caso 1 pílula tenha oscilado durante ressincronização
    if (combined.length >= 4 && incoming.length >= 4) {
      for (let shift = 0; shift <= Math.min(4, incoming.length - 4); shift++) {
        let matches = 0;
        for (let i = 0; i < 4; i++) {
          if (incoming[shift + i] === combined[i]) matches++;
        }
        if (matches >= 3) {
          if (shift === 0) {
            return { nextSession: prevSession, nextBackup: prevBackup };
          }
          return {
            nextSession: [...incoming.slice(0, shift), ...prevSession].slice(0, 500),
            nextBackup: prevBackup,
          };
        }
      }
    }
  }

  // Evita duplicar backup caso chegue o mesmo cabeçalho completo repetido
  if (
    prevBackup.length >= 2 &&
    incoming.length >= 2 &&
    prevBackup[0] === incoming[0] &&
    prevBackup[1] === incoming[1] &&
    prevSession.length === 0
  ) {
    return { nextSession: prevSession, nextBackup: prevBackup };
  }

  // Primeira leitura da mesa (ou troca de mesa): alimenta o contexto/aprendizagem
  // sem gerar % falsa de acerto na sessão atual
  return {
    nextSession: prevSession,
    nextBackup: [...incoming, ...prevBackup].slice(0, 2000),
  };
}
