import React, { useRef, useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Message, Campaign } from '../types';
import { CRM_PROVIDERS, CrmService, CrmStage } from '../services/crmService';
import './MessageCreator.css';

interface MessageCreatorProps {
  onAddCampaign: (campaign: Omit<Campaign, 'id'>) => string; // retorna id local
  onUpdateCampaign?: (campaign: Campaign) => void;
  campaignToEdit?: Campaign | null;
  existingCampaigns: Campaign[];
  isOpen: boolean;
  onClose: () => void;
}

const MessageCreator: React.FC<MessageCreatorProps> = ({ onAddCampaign, onUpdateCampaign, campaignToEdit, existingCampaigns, isOpen, onClose }) => {
  const [sequenceName, setSequenceName] = useState('');
  const [currentType, setCurrentType] = useState<Message['tipo']>('texto');
  const [currentContent, setCurrentContent] = useState('');
  const [parts, setParts] = useState<Message[]>([]);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const contentRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [fileInfo, setFileInfo] = useState<string>('');
  // Estados específicos de mídia/anexo
  const [currentBase64, setCurrentBase64] = useState<string>('');
  const [currentMime, setCurrentMime] = useState<string>('');
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [currentSize, setCurrentSize] = useState<number>(0);
  // Estados para CRM
  const [selectedCrmProvider, setSelectedCrmProvider] = useState<string>('');
  const [selectedCrmStage, setSelectedCrmStage] = useState<string>('');
  const [crmStages, setCrmStages] = useState<CrmStage[]>([]);
  const [loadingStages, setLoadingStages] = useState<boolean>(false);
  const [isEditingCampaign, setIsEditingCampaign] = useState<boolean>(false);

  // Carregar stages quando um provedor CRM é selecionado
  useEffect(() => {
    const loadCrmStages = async () => {
      if (!selectedCrmProvider) {
        setCrmStages([]);
        setSelectedCrmStage('');
        return;
      }

      setLoadingStages(true);
      try {
        const stages = await CrmService.getStages(selectedCrmProvider);
        setCrmStages(stages);
        console.log('🔄 Stages carregados:', stages);
        
        // Seleciona o primeiro stage por padrão APENAS para nova campanha
        if (stages.length > 0 && !selectedCrmStage && !isEditingCampaign) {
          setSelectedCrmStage(stages[0].id);
          console.log('✅ Stage padrão selecionado:', stages[0].id);
        }
      } catch (error) {
        console.error('Erro ao carregar stages do CRM:', error);
        // Fallback para stages do provider
        const provider = CRM_PROVIDERS.find(p => p.id === selectedCrmProvider);
        if (provider) {
          setCrmStages(provider.stages);
          console.log('🔄 Fallback stages carregados:', provider.stages);
          if (provider.stages.length > 0 && !selectedCrmStage && !isEditingCampaign) {
            setSelectedCrmStage(provider.stages[0].id);
            console.log('✅ Stage padrão fallback selecionado:', provider.stages[0].id);
          }
        }
      } finally {
        setLoadingStages(false);
      }
    };

    loadCrmStages();
  }, [selectedCrmProvider]);

  // Preencher quando estiver editando
  React.useEffect(() => {
    if (campaignToEdit && isOpen) {
      setIsEditingCampaign(true);
      setSequenceName(campaignToEdit.nome);
      // Normaliza mensagens antigas: se conteudo tiver data URL, extrai mime/base64 e limpa conteudo
      const normalized = campaignToEdit.mensagens
        .sort((a,b)=>a.ordem-b.ordem)
        .map((m) => {
          if (m.conteudo && /^data:[^;]+;base64,/.test(m.conteudo)) {
            const match = m.conteudo.match(/^data:([^;]+);base64,(.*)$/);
            if (match) {
              return { ...m, mimeType: m.mimeType || match[1], base64: m.base64 || match[2], conteudo: '' };
            }
          }
          return m;
        });
      setParts(normalized as Message[]);
      setCurrentType('texto');
      setCurrentContent('');
      setErrors({});
      
      // Configurar CRM ao editar
      const crmProvider = campaignToEdit.crmProvider || '';
      const crmStage = campaignToEdit.crmStage || '';
      
      console.log('🔍 DEBUG - Carregando campanha para edição:', {
        campaignId: campaignToEdit.id,
        campaignName: campaignToEdit.nome,
        crmProvider,
        crmStage,
        fullCampaign: campaignToEdit
      });
      
      setSelectedCrmProvider(crmProvider);
      
      // Se há um provider CRM, carregar os stages e definir o stage selecionado
      if (crmProvider) {
        console.log('📋 Carregando stages para provider:', crmProvider);
        const loadStagesForEdit = async () => {
          try {
            const stages = await CrmService.getStages(crmProvider);
            console.log('✅ Stages carregados:', stages);
            setCrmStages(stages);
            setSelectedCrmStage(crmStage);
            console.log('🎯 Stage selecionado definido como:', crmStage);
          } catch (error) {
            console.error('❌ Erro ao carregar stages para edição:', error);
            // Fallback para stages do provider
            const provider = CRM_PROVIDERS.find(p => p.id === crmProvider);
            if (provider) {
              console.log('🔄 Usando fallback stages:', provider.stages);
              setCrmStages(provider.stages);
              setSelectedCrmStage(crmStage);
            }
          }
        };
        loadStagesForEdit();
      } else {
        console.log('❌ Nenhum CRM provider encontrado na campanha');
        setSelectedCrmStage('');
        setCrmStages([]);
      }
    } else if (isOpen && !campaignToEdit) {
      setIsEditingCampaign(false);
      setSequenceName('');
      setParts([]);
      setCurrentType('texto');
      setCurrentContent('');
      setErrors({});
      setSelectedCrmProvider('');
      setSelectedCrmStage('');
      setCrmStages([]);
    }
  }, [campaignToEdit, isOpen]);

  const messageTypes = [
    { value: 'texto', label: 'Texto', icon: '📝' },
    { value: 'audio', label: 'Áudio', icon: '🎵' },
    { value: 'documento', label: 'Documento', icon: '📄' },
    { value: 'video', label: 'Vídeo', icon: '🎥' },
    { value: 'imagem', label: 'Imagem', icon: '🖼️' }
  ];

  const validateToAddPart = (): boolean => {
    const newErrors: { [key: string]: string } = {};
    if (currentType === 'texto') {
      if (!currentContent.trim()) newErrors.conteudo = 'Conteúdo é obrigatório';
    } else {
      if (!currentBase64 || !currentMime) newErrors.conteudo = 'Selecione um arquivo ou grave o áudio';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const insertAtCursor = (token: string) => {
    if (currentType !== 'texto') return; // só para texto
    const el = contentRef.current;
    if (!el) {
      setCurrentContent(prev => prev + token);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = currentContent.slice(0, start);
    const after = currentContent.slice(end);
    const next = `${before}${token}${after}`;
    setCurrentContent(next);
    // reposicionar o cursor após o token
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const validateToSaveSequence = (): boolean => {
    const newErrors: { [key: string]: string } = {};
    if (!sequenceName.trim()) newErrors.nome = 'Nome da sequência é obrigatório';
    if (parts.length === 0) newErrors.sequencia = 'Inclua pelo menos 1 passo na sequência';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const addPartToSequence = () => {
    if (!validateToAddPart()) return;
    const nextOrder = parts.length + 1;
    const newPart: Message =
      currentType === 'texto'
        ? {
            id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
            nome: `${currentType} ${nextOrder}`,
            tipo: currentType,
            conteudo: currentContent.trim(),
            ordem: nextOrder,
          }
        : {
            id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
            nome: currentFileName || `${currentType} ${nextOrder}`,
            tipo: currentType,
            conteudo: '',
            base64: currentBase64,
            mimeType: currentMime,
            fileName: currentFileName || undefined,
            sizeBytes: currentSize || undefined,
            ordem: nextOrder,
          };
    setParts(prev => [...prev, newPart]);
    setCurrentContent('');
    setFileInfo('');
    setCurrentBase64('');
    setCurrentMime('');
    setCurrentFileName('');
    setCurrentSize(0);
    setErrors(prev => {
      const { conteudo: _removed, ...rest } = prev;
      return rest;
    });
  };

  const removePart = (id: string) => {
    setParts(prev => prev.filter(p => p.id !== id).map((p, i) => ({ ...p, ordem: i + 1 })));
  };

  const movePart = (id: string, direction: 'up' | 'down') => {
    setParts(prev => {
      const idx = prev.findIndex(p => p.id === id);
      if (idx === -1) return prev;
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= prev.length) return prev;
      const newArr = [...prev];
      [newArr[idx], newArr[swapWith]] = [newArr[swapWith], newArr[idx]];
      return newArr.map((p, i) => ({ ...p, ordem: i + 1 }));
    });
  };

  const handleSaveSequence = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateToSaveSequence()) return;
    const data: Omit<Campaign, 'id'> = {
      nome: sequenceName.trim(),
      mensagens: parts.map((p, i) => ({ ...p, ordem: i + 1 })),
      crmProvider: selectedCrmProvider || undefined,
      crmStage: selectedCrmStage || undefined
    };
    const auth = getAuth();
    const uid = auth.currentUser?.uid;


    if (campaignToEdit && onUpdateCampaign) {
      // Atualização
      const updated: Campaign = { id: campaignToEdit.id, ...data } as Campaign;
      try {
        if (uid) {
          const { collection, query, where, getDocs, updateDoc, doc, getDoc } = await import('firebase/firestore');
          const ref = collection(db, 'users', uid, 'campaigns');
          const q = query(ref, where('localId', '==', campaignToEdit.id));
          const snap = await getDocs(q);
          // Preparar dados para Firebase (remover undefined)
          const updateData: any = {
            nome: updated.nome,
            mensagens: updated.mensagens
          };
          if (updated.crmProvider) updateData.crmProvider = updated.crmProvider;
          if (updated.crmStage) updateData.crmStage = updated.crmStage;

          if (snap.size > 0) {
            for (const d of snap.docs) {
              await updateDoc(doc(db, 'users', uid, 'campaigns', d.id), updateData);
            }
          } else {
            // Fallback: documento pode não ter localId (criado antes). Tenta atualizar pelo docId diretamente
            const directRef = doc(db, 'users', uid, 'campaigns', campaignToEdit.id);
            const exists = await getDoc(directRef);
            if (exists.exists()) {
              await updateDoc(directRef, updateData);
            }
          }
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Falha ao atualizar sequência no Firestore', err);
      }
      onUpdateCampaign(updated);
    } else {
      // Criação
      const localId = onAddCampaign(data);
      try {
        if (uid) {
          const ref = collection(db, 'users', uid, 'campaigns');
          await addDoc(ref, {
            nome: data.nome,
            mensagens: data.mensagens,
            crmProvider: data.crmProvider,
            crmStage: data.crmStage,
            userId: uid,
            localId,
            createdAt: serverTimestamp()
          });
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Falha ao salvar sequência no Firestore', err);
      }
    }
    setSequenceName('');
    setCurrentType('texto');
    setCurrentContent('');
    setParts([]);
    setErrors({});
    setSelectedCrmProvider('');
    setSelectedCrmStage('');
    onClose();
  };

  const clearError = (field: string) => {
    if (errors[field]) {
      setErrors(prev => {
        const { [field]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const getContentPlaceholder = () => {
    switch (currentType) {
      case 'texto':
        return 'Digite o texto da mensagem...';
      case 'audio':
        return 'Grave um áudio (botão ao lado)';
      case 'documento':
        return 'Anexe um documento (botão de clipe)';
      case 'video':
        return 'Anexe um vídeo (botão de clipe)';
      case 'imagem':
        return 'Anexe uma imagem (botão de clipe)';
      default:
        return 'Digite o conteúdo...';
    }
  };

  // Utilidades de arquivo/base64
  const toDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleAttach = async (file: File) => {
    // Limite simples para evitar estourar limite do documento (aprox 1MB). Base64 aumenta ~33%
    const maxBytes = 700 * 1024; // ~700KB
    if (file.size > maxBytes) {
      alert('Arquivo muito grande. Tamanho máximo aproximado: 700KB');
      return;
    }
    const dataUrl = await toDataUrl(file);
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (match) {
      setCurrentMime(match[1]);
      setCurrentBase64(match[2]);
    } else {
      // fallback: se não casar, tenta tudo como base64 sem mime
      setCurrentMime(file.type || 'application/octet-stream');
      setCurrentBase64(dataUrl);
    }
    setCurrentFileName(file.name);
    setCurrentSize(file.size);
    setFileInfo(`${file.name} • ${(file.size / 1024).toFixed(0)}KB`);
  };

  const startRecording = async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: BlobPart[] = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const file = new File([blob], `audio_${Date.now()}.webm`, { type: 'audio/webm' });
        await handleAttach(file);
        setRecording(false);
        stream.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e) {
      console.error('Gravação não suportada ou permissão negada', e);
      alert('Não foi possível iniciar a gravação de áudio neste dispositivo.');
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && recording) mr.stop();
  };

  return (
    <div className="message-creator">
      {isOpen && (
        <div className="modal-overlay" onClick={onClose}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{campaignToEdit ? 'Editar Sequência' : 'Nova Sequência'}</h3>
              <button
                type="button"
                className="close-btn"
                onClick={onClose}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSaveSequence} className="message-form">
              <div className="form-group">
                <label htmlFor="nome-seq">Nome da Sequência *</label>
                <input
                  type="text"
                  id="nome-seq"
                  value={sequenceName}
                  onChange={(e) => { setSequenceName(e.target.value); clearError('nome'); }}
                  className={errors.nome ? 'error' : ''}
                  placeholder="Ex: Boas-vindas + Apresentação"
                />
                {errors.nome && <span className="error-message">{errors.nome}</span>}
              </div>

              <div className="form-group">
                <label>Tipo de Mensagem *</label>
                <div className="type-selector inline-icons">
                  {messageTypes.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      className={`type-option ${currentType === type.value ? 'selected' : ''}`}
                      onClick={() => { setCurrentType(type.value as Message['tipo']); clearError('tipo'); }}
                      aria-label={type.label}
                      title={type.label}
                    >
                      <span className="type-icon">{type.icon}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <div className="field-header">
                  <label htmlFor="conteudo">Conteúdo *</label>
                  <div className="tag-chips">
                    <button
                      type="button"
                      className="tag-chip"
                      onClick={() => insertAtCursor('{{nome}}')}
                      disabled={currentType !== 'texto'}
                      title={currentType !== 'texto' ? 'Disponível apenas para mensagem de texto' : 'Inserir {{nome}}'}
                    >
                      {'{{nome}}'}
                    </button>
                    <button
                      type="button"
                      className="tag-chip"
                      onClick={() => insertAtCursor('{{empresa}}')}
                      disabled={currentType !== 'texto'}
                      title={currentType !== 'texto' ? 'Disponível apenas para mensagem de texto' : 'Inserir {{empresa}}'}
                    >
                      {'{{empresa}}'}
                    </button>
                  </div>
                </div>
                <div className="content-input-box">
                  {currentType === 'texto' ? (
                    <>
                      <textarea
                        id="conteudo"
                        ref={contentRef}
                        value={currentContent}
                        onChange={(e) => { setCurrentContent(e.target.value); clearError('conteudo'); }}
                        className={errors.conteudo ? 'error' : ''}
                        placeholder={getContentPlaceholder()}
                        rows={3}
                      />
                      <button
                        type="button"
                        className="add-to-seq-btn"
                        onClick={addPartToSequence}
                        aria-label="Adicionar à sequência"
                        title="Adicionar à sequência"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
                        </svg>
                      </button>
                    </>
                  ) : currentType === 'audio' ? (
                    <div className="non-text-box">
                      <div className={`record-box ${recording ? 'recording' : ''}`}>
                        <button type="button" className="record-btn" onClick={recording ? stopRecording : startRecording}>
                          {recording ? 'Parar' : 'Gravar'}
                        </button>
                        {fileInfo && <span className="file-info">{fileInfo}</span>}
                      </div>
                      <button
                        type="button"
                        className="add-to-seq-btn"
                        onClick={addPartToSequence}
                        aria-label="Adicionar à sequência"
                        title="Adicionar à sequência"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="non-text-box">
                      <input
                        type="file"
                        id="attach-input"
                        style={{ display: 'none' }}
                        accept={currentType === 'imagem' ? 'image/*' : currentType === 'video' ? 'video/*' : currentType === 'documento' ? '*/*' : ''}
                        onChange={async (e) => {
                          const inputEl = e.currentTarget;
                          const f = inputEl.files?.[0];
                          if (f) {
                            await handleAttach(f);
                          }
                          // limpar o valor do input mesmo após await
                          try { inputEl.value = ''; } catch {}
                        }}
                      />
                      <button type="button" className="attach-btn" onClick={() => document.getElementById('attach-input')?.click()}>
                        📎 Anexar
                      </button>
                      {fileInfo && <span className="file-info">{fileInfo}</span>}
                      <button
                        type="button"
                        className="add-to-seq-btn"
                        onClick={addPartToSequence}
                        aria-label="Adicionar à sequência"
                        title="Adicionar à sequência"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
                {errors.conteudo && <span className="error-message">{errors.conteudo}</span>}
              </div>

              {parts.length > 0 && (
                <div className="selected-summary">
                  <div className="selected-messages-list">
                    {parts.map((p, idx) => (
                      <div key={p.id} className="sequence-card">
                        <div className="sequence-card-header">
                          <span className="sequence-number">{idx + 1}</span>
                          <div className="reorder-btns">
                            <button type="button" aria-label="Subir" title="Subir" onClick={() => movePart(p.id, 'up')}>▲</button>
                            <button type="button" aria-label="Descer" title="Descer" onClick={() => movePart(p.id, 'down')}>▼</button>
                          </div>
                        </div>
                        <div className="sequence-card-body">
                          <span className="message-icon">{
                            p.tipo === 'texto' ? '📝' : p.tipo === 'audio' ? '🎵' : p.tipo === 'documento' ? '📄' : p.tipo === 'video' ? '🎥' : '🖼️'
                          }</span>
                          <div className="sequence-content">
                            {p.tipo === 'texto' ? (
                              <> {/^data:[^;]+;base64,/.test(p.conteudo || '') ? (p.fileName || `${p.tipo} anexado`) : p.conteudo} </>
                            ) : p.tipo === 'imagem' && p.base64 && p.mimeType ? (
                              <img alt={p.fileName || 'Imagem'} src={`data:${p.mimeType};base64,${p.base64}`} style={{ maxWidth: '140px', borderRadius: 6 }} />
                            ) : p.tipo === 'video' && p.base64 && p.mimeType ? (
                              <video controls style={{ maxWidth: '160px' }} src={`data:${p.mimeType};base64,${p.base64}`} />
                            ) : p.tipo === 'audio' && p.base64 && p.mimeType ? (
                              <audio controls src={`data:${p.mimeType};base64,${p.base64}`} />
                            ) : (
                              <span>{p.fileName || `${p.tipo} anexado`}</span>
                            )}
                          </div>
                        </div>
                        <button type="button" className="remove-card-btn" aria-label="Remover" title="Remover" onClick={() => removePart(p.id)}>🗑️</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {errors.sequencia && <span className="error-message">{errors.sequencia}</span>}

              {/* Seção CRM */}
              <div className="form-group crm-section">
                <label htmlFor="crm-provider">Envio para CRM</label>
                <div className="crm-selection">
                  <select
                    id="crm-provider"
                    value={selectedCrmProvider}
                    onChange={(e) => setSelectedCrmProvider(e.target.value)}
                    className="crm-provider-select"
                  >
                    <option value="">Selecionar CRM...</option>
                    {CRM_PROVIDERS.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                  
                  {selectedCrmProvider && (
                    <div className="crm-stage-selection">
                      <label htmlFor="crm-stage">Stage da Oportunidade</label>
                      <select
                        id="crm-stage"
                        value={selectedCrmStage}
                        onChange={(e) => setSelectedCrmStage(e.target.value)}
                        className="crm-stage-select"
                        disabled={loadingStages}
                      >
                        {loadingStages ? (
                          <option>Carregando...</option>
                        ) : (
                          crmStages.map((stage) => (
                            <option key={stage.id} value={stage.id}>
                              {stage.name}
                              {stage.probability !== undefined && ` (${stage.probability}%)`}
                            </option>
                          ))
                        )}
                      </select>
                      {!CrmService.isProviderConfigured(selectedCrmProvider) && (
                        <div className="crm-warning">
                          ⚠️ CRM não configurado. Verifique as variáveis de ambiente.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="form-actions">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={onClose}
                >
                  Cancelar
                </button>
                <button type="submit" className="save-btn">
                  {campaignToEdit ? 'Salvar Alterações' : 'Salvar Sequência'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageCreator;
