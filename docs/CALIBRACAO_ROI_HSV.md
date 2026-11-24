# Guia de Calibração ROI, Perfis HSV e Captura em Background — RoletaVision

## 1. Calibração de ROI por Jogo e Site
- **Roleta Europeia:** Posicione a caixa verde exatamente sobre a faixa horizontal dos últimos números (`Topo ~4%`, `Altura ~8%`). Evite incluir botões de aposta ou multiplicadores relâmpago acima/abaixo da faixa.
- **Bac Bo:**
  - **Modo Blocos:** Enquadre os cartões **JOGADOR** (azul, esquerda) e **BANCA** (vermelho, direita) (`Topo ~34%`, `Altura ~40%`).
  - **Modo Bead Plate:** Enquadre exclusivamente a grelha inferior de resultados (`Topo ~52%`, `Altura ~38%`). Se os dígitos dentro das bolas estiverem muito pequenos, o fallback HSV lê a cor dominante de cada célula.
- **Aviator:** Enquadre a barra superior de velas recentes e o multiplicador central (`Topo ~14%`, `Altura ~34%`).

## 2. Perfis de Cor HSV por Site
- Cada casa (ex.: `kwanzabet`, `creedroomz`, `evolution`) usa tons ligeiramente diferentes de vermelho, verde, azul e dourado.
- Na aba **Estratégias → Calibração ROI & HSV**, selecione o site e adicione **8–12 amostras** (ou utilize os presets) para ajustar automaticamente os limites de **Hue / Saturation / Value**.

## 3. Captura em Segundo Plano (`GameCaptureService` / MediaProjection)
- O Android exige notificação persistente (`foregroundServiceType="mediaProjection"`) enquanto a leitura externa estiver ativa.
- **Limitações do sistema Android:**
  1. Se o utilizador bloquear o ecrã ou revogar a captura na notificação, o `MediaProjection` encerra por segurança do SO e precisa de nova autorização ao retomar.
  2. Em Android 14+, o token `MediaProjection` é de uso único por sessão de captura.
  3. O filtro `dHash + luminância` descarta automaticamente frames estáticos dentro da ROI para reduzir aquecimento e consumo de bateria; desative a otimização agressiva de bateria para a app RoletaVision se o sistema suspender o serviço após longos períodos em segundo plano.

> *Aviso estatístico: Isto são padrões observados. A casa tem vantagem a longo prazo.*
