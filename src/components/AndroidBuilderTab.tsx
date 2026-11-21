import React, { useState } from 'react';
import { Smartphone, FolderGit2, ShieldCheck, Check, Copy } from 'lucide-react';

interface AndroidBuilderTabProps {
  roiTopPct: number;
  roiHeightPct: number;
}

export const AndroidBuilderTab: React.FC<AndroidBuilderTabProps> = ({
  roiTopPct,
  roiHeightPct,
}) => {
  const [defaultUrl, setDefaultUrl] = useState('https://www.kwanzabet.ao');
  const [copied, setCopied] = useState(false);

  const androidFiles = [
    {
      path: '.github/workflows/build-apk.yml',
      role: 'Compila automaticamente o projeto Android no GitHub Actions e gera o APK para download',
    },
    {
      path: 'android-app/app/src/main/java/ao/kwanzabet/roletavision/MainActivity.kt',
      role: 'Navegador integrado (WebView com cookies + vídeo ao vivo) e painel inferior expansível',
    },
    {
      path: 'android-app/app/src/main/java/ao/kwanzabet/roletavision/ScreenScanner.kt',
      role: 'Captura automática da faixa superior via PixelCopy + Google ML Kit OCR + validação por cor RGB',
    },
    {
      path: 'android-app/app/src/main/java/ao/kwanzabet/roletavision/RouletteEngine.kt',
      role: 'Motor estatístico da roda europeia, vizinhos, setores, atrasos e aprendizado de transições',
    },
    {
      path: 'android-app/app/src/main/java/ao/kwanzabet/roletavision/SpinDatabase.kt',
      role: 'Banco SQLite local para gravar giros entre sessões e alimentar o aprendizado contínuo',
    },
  ];

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(defaultUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <div className="lg:col-span-7 space-y-5">
        <div className="rounded-xl border border-slate-800 bg-[#131924] p-6">
          <div className="flex items-center gap-3">
            <Smartphone className="h-5 w-5 text-amber-400 shrink-0" />
            <h2 className="text-lg font-semibold text-slate-100">
              Projeto Android Nativo Pronto para GitHub → APK
            </h2>
          </div>
          <p className="mt-2 text-sm text-slate-400 leading-relaxed">
            O código-fonte nativo em Kotlin já foi gerado dentro da pasta{' '}
            <span className="font-mono text-slate-200">android-app/</span> deste repositório,
            junto com o workflow de compilação automática em{' '}
            <span className="font-mono text-slate-200">.github/workflows/build-apk.yml</span>.
          </p>

          <div className="mt-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-200">
              Como baixar o aplicativo instalado no seu telefone
            </h3>
            <ol className="space-y-2.5 text-sm text-slate-300">
              <li className="flex gap-3">
                <span className="font-mono text-xs font-bold text-amber-400 pt-0.5">01.</span>
                <span>
                  Exporte ou envie este projeto completo para o seu repositório no{' '}
                  <strong className="text-slate-100">GitHub</strong> (ramo{' '}
                  <span className="font-mono text-xs">main</span>).
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs font-bold text-amber-400 pt-0.5">02.</span>
                <span>
                  Abra a aba <strong className="text-slate-100">Actions</strong> no GitHub. O
                  fluxo <span className="font-mono text-xs">Build Android APK</span> executará
                  automaticamente e disponibilizará o arquivo{' '}
                  <span className="font-mono text-xs text-emerald-400">
                    RoletaVision-Android-APK
                  </span>{' '}
                  nos artefatos.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs font-bold text-amber-400 pt-0.5">03.</span>
                <span>
                  Baixe o <span className="font-mono text-xs">.apk</span> no seu Android, instale,
                  faça login na Kwanzabet pelo navegador interno do app e toque em{' '}
                  <strong className="text-slate-100">Calibrar Faixa</strong> +{' '}
                  <strong className="text-slate-100">Testar Leitura</strong> (padrão interno
                  calibrado em topo 4%, altura 7%, leitura a cada 1 segundo).
                </span>
              </li>
            </ol>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#131924] p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <FolderGit2 className="h-4 w-4 text-emerald-400 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-100">
              Arquivos Nativos Incluídos no Repositório
            </h3>
          </div>
          <div className="divide-y divide-slate-800/80">
            {androidFiles.map((file) => (
              <div key={file.path} className="py-3 first:pt-0 last:pb-0">
                <div className="font-mono text-xs text-amber-300 break-all">{file.path}</div>
                <div className="mt-1 text-xs text-slate-400">{file.role}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lg:col-span-5 space-y-5">
        <div className="rounded-xl border border-slate-800 bg-[#131924] p-6">
          <h3 className="text-sm font-semibold text-slate-100">
            Sobre o Link de Acesso (Kwanzabet)
          </h3>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            Links como <span className="font-mono text-slate-300">games.kwanzabet.ao/LaunchG...</span>{' '}
            possuem um token temporário da sua sessão e expiram após algum tempo. Por isso, o
            navegador integrado inicia em{' '}
            <span className="font-mono text-slate-200">https://www.kwanzabet.ao</span>, guarda
            seus cookies de login e permite colar qualquer link direto quando quiser.
          </p>

          <div className="mt-4">
            <label className="block text-xs text-slate-400 mb-1.5">
              URL inicial padrão do navegador integrado
            </label>
            <div className="flex gap-2">
              <input
                type="url"
                value={defaultUrl}
                onChange={(e) => setDefaultUrl(e.target.value)}
                className="flex-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCopyUrl}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copied ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#131924] p-6">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-100">
              Por que não precisa gravar a tela do sistema?
            </h3>
          </div>
          <p className="mt-2 text-xs text-slate-400 leading-relaxed">
            Como o jogo abre dentro do <span className="font-mono text-slate-200">WebView</span> do
            próprio app, o Android lê o conteúdo da janela internamente sem pop-ups de permissão de
            gravação, consumindo menos bateria e mantendo os dados privados localmente no SQLite do
            seu aparelho.
          </p>
        </div>
      </div>
    </div>
  );
};
