export interface Lead {
  id?: string;
  nome: string;
  empresa: string;
  telefone: string;
  createdAt?: Date;
}

export interface Message {
  id: string;
  tipo: 'texto' | 'audio' | 'documento' | 'video' | 'imagem';
  // Para texto, usar 'conteudo'. Para mídia/anexo, NÃO usar data URL aqui.
  // Em vez disso, use 'base64' (somente a parte base64 sem prefixo) e 'mimeType'.
  conteudo: string;
  base64?: string;      // apenas a string base64 (sem 'data:...;base64,')
  mimeType?: string;    // exemplo: 'audio/webm', 'image/png', 'video/mp4', 'application/pdf'
  fileName?: string;    // nome amigável do arquivo
  sizeBytes?: number;   // tamanho do arquivo original em bytes
  nome: string;
  ordem: number;
}

export interface Campaign {
  id: string;
  nome: string;
  mensagens: Message[];
  crmProvider?: string;
  crmStage?: string;
}
