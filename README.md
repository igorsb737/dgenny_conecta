# DGenny Conecta - Sistema de Feira de Eventos

Sistema de captura de leads para feira de eventos com interface responsiva otimizada para celular.

## Funcionalidades

- ✅ Formulário de captura de leads (nome, empresa, telefone com máscara)
- ✅ Sistema de criação de mensagens (texto, áudio, documento, vídeo, imagem)
- ✅ Seleção e sequenciamento de mensagens para envio
- ✅ Interface responsiva otimizada para celular
- ✅ Validações de formulário
- ✅ Histórico de leads capturados

## Tecnologias

- React 18
- TypeScript
- CSS3 com design responsivo
- React Input Mask para máscara de telefone

## Instalação

1. Instale as dependências:
```bash
npm install
```

2. Execute o projeto em modo de desenvolvimento:
```bash
npm start
```

3. Acesse http://localhost:3000 no navegador

## Estrutura do Projeto

```
src/
├── components/
│   ├── LeadForm.tsx          # Formulário de captura de leads
│   ├── LeadForm.css
│   ├── MessageSelector.tsx   # Seleção de mensagens
│   ├── MessageSelector.css
│   ├── MessageCreator.tsx    # Criação de novas mensagens
│   └── MessageCreator.css
├── types/
│   └── index.ts             # Definições de tipos TypeScript
├── App.tsx                  # Componente principal
├── App.css
├── index.tsx               # Ponto de entrada
└── index.css              # Estilos globais
```

## Como Usar

1. **Criar Mensagens**: Clique em "Adicionar Nova Mensagem" para criar mensagens que serão enviadas aos leads
2. **Selecionar Mensagens**: Use o dropdown para escolher quais mensagens enviar
3. **Capturar Lead**: Preencha o formulário com nome, empresa e telefone do lead
4. **Enviar**: Clique em "Enviar" para capturar o lead e disparar as mensagens selecionadas

## Próximos Passos (Backend)

- [ ] Integração com Firebase para autenticação
- [ ] Banco de dados para persistir leads e mensagens
- [ ] Sistema de webhooks para envio de mensagens
- [ ] Dashboard administrativo
- [ ] Relatórios e analytics

## Design Responsivo

O sistema foi desenvolvido com abordagem mobile-first e é totalmente responsivo:
- Otimizado para telas de celular
- Interface touch-friendly
- Prevenção de zoom em campos de input no iOS
- Layout adaptativo para diferentes tamanhos de tela
