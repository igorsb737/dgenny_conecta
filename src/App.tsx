import React, { useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged, signOut, User } from 'firebase/auth';
import { addDoc, collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, startAfter, updateDoc, where } from 'firebase/firestore';
import { db } from './firebase';
import Login from './components/Login';
import LeadForm from './components/LeadForm';
import MessageCreator from './components/MessageCreator';
import OfflineStatus from './components/OfflineStatus';
import LeadsManager from './components/LeadsManager';
import { offlineService } from './services/offlineService';
import { Lead, Campaign } from './types';
import './App.css';

const App: React.FC = () => {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [campaignToEdit, setCampaignToEdit] = useState<Campaign | null>(null);
  // Leads UI state
  const [leadsCollapsed, setLeadsCollapsed] = useState(true);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsHasMore, setLeadsHasMore] = useState(false);
  const [leadsCursor, setLeadsCursor] = useState<any>(null);
  const [noteEditId, setNoteEditId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  // Perfil do operador
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  // Gerenciador de leads
  const [showLeadsManager, setShowLeadsManager] = useState(false);

  // Restaurar seleção do localStorage (somente ID)
  useEffect(() => {
    try {
      const rawSel = localStorage.getItem('dgenny_selected_campaign');
      if (rawSel) setSelectedCampaignId(rawSel);
    } catch {}
  }, []);

  // Observa autenticação
  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, (u: User | null) => setUser(u));
    return () => unsub();
  }, []);

  // Carregar perfil local
  useEffect(() => {
    try {
      const raw = localStorage.getItem('dgenny_profile');
      if (raw) {
        const parsed = JSON.parse(raw);
        setProfileName(parsed?.name || '');
        setProfilePhone(parsed?.phone || '');
      }
    } catch {}
  }, []);

  // Sincronizar perfil com Firestore (users/{uid}/profile/main)
  useEffect(() => {
    if (!user?.uid) return;
    const profileRef = doc(db, 'users', user.uid, 'profile', 'main');
    const unsub = onSnapshot(profileRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        const n = data?.name || '';
        const p = data?.phone || '';
        setProfileName(n);
        setProfilePhone(p);
        try { localStorage.setItem('dgenny_profile', JSON.stringify({ name: n, phone: p })); } catch {}
      }
    });
    return () => unsub();
  }, [user?.uid]);

  // Sincroniza campanhas do Firestore em tempo real para o usuário logado
  useEffect(() => {
    const loadCampaigns = async () => {
      // SEMPRE tentar carregar campanhas offline primeiro (com ou sem usuário)
      try {
        const offlineCampaigns = await offlineService.getCampaigns();
        console.log('🔍 Verificando campanhas offline:', offlineCampaigns.length);
        
        if (offlineCampaigns.length > 0) {
          const campaigns = offlineCampaigns.map(c => ({
            id: c.id,
            nome: c.nome,
            mensagens: c.mensagens,
            crmProvider: c.crmProvider,
            crmStage: c.crmStage
          }));
          setCampaigns(campaigns);
          console.log('📱 Campanhas carregadas do cache offline:', campaigns.length);
        }
      } catch (error) {
        console.warn('⚠️ Erro ao carregar campanhas offline:', error);
      }

      if (!user?.uid) {
        console.log('👤 Sem usuário logado - usando apenas campanhas offline');
        return;
      }

      // Com usuário logado, tentar Firebase para atualizações

      // Com usuário, tentar Firebase primeiro, fallback para offline
      try {
        const ref = collection(db, 'users', user.uid, 'campaigns');
        const q = query(ref, orderBy('createdAt', 'desc'));
        const unsub = onSnapshot(q, async (snap) => {
          const items: Campaign[] = snap.docs.map((d) => {
            const data = d.data() as any;
            return {
              id: data?.localId || d.id,
              nome: data?.nome || '',
              mensagens: Array.isArray(data?.mensagens) ? data.mensagens : [],
              crmProvider: data?.crmProvider || undefined,
              crmStage: data?.crmStage || undefined
            } as Campaign;
          });
          
          console.log('🔥 Campanhas do Firestore:', items.length);
          
          // Só atualizar se Firebase retornou campanhas OU se não temos campanhas offline
          if (items.length > 0) {
            setCampaigns(items);
            console.log('✅ Atualizando campanhas com dados do Firebase');
          } else {
            // Firebase retornou vazio - manter campanhas offline se existirem
            const currentCampaigns = campaigns.length;
            if (currentCampaigns === 0) {
              setCampaigns(items); // Só limpar se já estava vazio
              console.log('📭 Firebase vazio e sem campanhas locais');
            } else {
              console.log('🛡️ Mantendo campanhas offline - Firebase retornou vazio');
            }
          }
          
          // Salvar campanhas offline para uso sem conexão
          if (items.length > 0) {
            try {
              const offlineCampaigns = items.map(c => ({
                id: c.id,
                nome: c.nome,
                mensagens: c.mensagens,
                crmProvider: c.crmProvider,
                crmStage: c.crmStage,
                createdAt: new Date(),
                syncedAt: new Date()
              }));
              await offlineService.saveCampaigns(offlineCampaigns);
            } catch (offlineError) {
              console.warn('⚠️ Erro ao salvar campanhas offline:', offlineError);
            }
          }
          
          // Se a seleção atual não existir mais, limpa (apenas se Firebase trouxe dados)
          if (items.length > 0 && selectedCampaignId && !items.some(i => i.id === selectedCampaignId)) {
            setSelectedCampaignId(null);
          }
        });
        return () => unsub();
      } catch (firebaseError) {
        console.warn('⚠️ Erro no Firebase, usando campanhas offline:', firebaseError);
        // Fallback para campanhas offline
        try {
          const offlineCampaigns = await offlineService.getCampaigns();
          const campaigns = offlineCampaigns.map(c => ({
            id: c.id,
            nome: c.nome,
            mensagens: c.mensagens,
            crmProvider: c.crmProvider,
            crmStage: c.crmStage
          }));
          setCampaigns(campaigns);
          console.log('📱 Fallback: campanhas offline carregadas:', campaigns.length);
        } catch (offlineError) {
          console.error('❌ Erro ao carregar campanhas offline:', offlineError);
          setCampaigns([]);
        }
      }
    };

    loadCampaigns();

    // Escutar eventos de atualização de campanhas do syncService
    const handleCampaignsUpdated = (event: any) => {
      const updatedCampaigns = event.detail;
      if (updatedCampaigns && updatedCampaigns.length > 0) {
        const campaigns = updatedCampaigns.map((c: any) => ({
          id: c.id,
          nome: c.nome,
          mensagens: c.mensagens || [],
          crmProvider: c.crmProvider,
          crmStage: c.crmStage,
          createdAt: c.createdAt || new Date(),
          syncedAt: c.syncedAt || new Date()
        }));
        
        // Não sobrescrever campanhas se o modal de edição estiver aberto
        if (!isMessageModalOpen) {
          setCampaigns(campaigns);
        }
      }
    };

    window.addEventListener('campaignsUpdated', handleCampaignsUpdated);
    
    return () => {
      window.removeEventListener('campaignsUpdated', handleCampaignsUpdated);
    };
  }, [user?.uid, selectedCampaignId, isMessageModalOpen]);

  // Persistir seleção
  useEffect(() => {
    try {
      if (selectedCampaignId) localStorage.setItem('dgenny_selected_campaign', selectedCampaignId);
      else localStorage.removeItem('dgenny_selected_campaign');
    } catch {}
  }, [selectedCampaignId]);

  // Não persistimos campanhas localmente: usamos Firestore em tempo real

  // Carregar últimos 5 leads do usuário autenticado (colocado antes do retorno condicional para manter ordem dos hooks)
  useEffect(() => {
    const loadInitialLeads = async () => {
      if (!user?.uid) { setLeads([]); return; }
      setLeadsLoading(true);
      try {
        const ref = collection(db, 'leads');
        const q = query(ref, where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(5));
        const snap = await getDocs(q);
        const items: Lead[] = snap.docs.map(d => ({
          id: d.id,
          ...(d.data() as any),
          createdAt: new Date()
        }));
        setLeads(items);
        const last = snap.docs[snap.docs.length - 1];
        setLeadsCursor(last || null);
        setLeadsHasMore(snap.size === 5);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Falha ao carregar leads', e);
      } finally {
        setLeadsLoading(false);
      }
    };
    loadInitialLeads();
  }, [user?.uid]);

  const handleAddCampaign = (campaignData: Omit<Campaign, 'id'>): string => {
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const newCampaign: Campaign = { id: newId, ...campaignData } as Campaign;
    setCampaigns(prev => [...prev, newCampaign]);
    return newId;
  };

  const handleUpdateCampaign = (updated: Campaign) => {
    setCampaigns(prev => prev.map(c => (c.id === updated.id ? updated : c)));
  };

  const handleEditCampaign = (campaign: Campaign) => {
    setCampaignToEdit(campaign);
    setIsMessageModalOpen(true);
  };

  const handleDeleteCampaign = async (campaign: Campaign) => {
    // Remove local
    setCampaigns(prev => prev.filter(c => c.id !== campaign.id));
    // Remover no Firestore por localId se existir
    try {
      if (user?.uid) {
        const { collection, query, where, getDocs, deleteDoc, doc, getDoc } = await import('firebase/firestore');
        const ref = collection((await import('./firebase')).db, 'users', user.uid, 'campaigns');
        const q = query(ref, where('localId', '==', campaign.id));
        const snap = await getDocs(q);
        if (snap.size > 0) {
          for (const d of snap.docs) {
            await deleteDoc(doc((await import('./firebase')).db, 'users', user.uid, 'campaigns', d.id));
          }
        } else {
          // Fallback: documento pode não ter localId. Tenta excluir pelo docId direto
          const directRef = doc((await import('./firebase')).db, 'users', user.uid, 'campaigns', campaign.id);
          const exists = await getDoc(directRef);
          if (exists.exists()) {
            await deleteDoc(directRef);
          }
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Falha ao excluir sequência no Firestore', err);
    }
    // Limpar seleção se a deletada estava selecionada
    setSelectedCampaignId(prev => (prev === campaign.id ? null : prev));
  };

  const handleLeadSubmit = async (lead: Lead) => {
    const normalizePhone = (raw: string) => {
      const digits = (raw || '').replace(/\D/g, '');
      if (digits.startsWith('55')) return digits;
      // remove 0 inicial, se houver
      const trimmed = digits.replace(/^0+/, '');
      return `55${trimmed}`;
    };

    const seq = campaigns.find(c => c.id === selectedCampaignId) || null;

    // REMOVIDO: Não salvar diretamente no Firebase aqui
    // O sistema offline agora gerencia tudo através do syncService
    
    // Atualizar apenas a lista local para feedback visual
    const newLeadLocal: Lead = {
      ...lead,
      id: `temp_${Date.now()}`,
      createdAt: new Date()
    };
    setLeads(prev => [newLeadLocal, ...prev].slice(0, 5));

    const seqName = seq?.nome || 'Nenhuma sequência';
    alert(`Lead ${lead.nome} capturado com sucesso!\nSequência selecionada: ${seqName}.`);

    // REMOVIDO: Disparo da sequência movido para syncService
    // O sistema offline agora gerencia o disparo após sincronização
    
    // Recarregar leads offline para atualizar contadores
    if ((window as any).offlineService) {
      const offlineLeads = await (window as any).offlineService.getLeads();
      // Trigger update no OfflineStatus
      window.dispatchEvent(new CustomEvent('offlineLeadsChanged', { detail: offlineLeads }));
    }
  };

  const handleCampaignChange = (campaignId: string | null) => {
    console.log('🎯 Selecionando campanha:', campaignId);
    setSelectedCampaignId(campaignId);
  };

  if (!user) {
    return <Login />;
  }

  const loadMoreLeads = async () => {
    if (!user?.uid || !leadsCursor) return;
    setLeadsLoading(true);
    try {
      const ref = collection(db, 'leads');
      const q = query(ref, where('userId', '==', user.uid), orderBy('createdAt', 'desc'), startAfter(leadsCursor), limit(10));
      const snap = await getDocs(q);
      const items: Lead[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any), createdAt: new Date() }));
      setLeads(prev => [...prev, ...items]);
      const last = snap.docs[snap.docs.length - 1];
      setLeadsCursor(last || null);
      setLeadsHasMore(snap.size === 10);
    } catch (e) {
      console.error('Falha ao paginar leads', e);
    } finally {
      setLeadsLoading(false);
    }
  };

  const startEditObservation = (leadId: string) => {
    const current = leads.find(l => l.id === leadId) as any;
    setNoteEditId(leadId);
    setNoteText(current?.observacao || '');
  };

  const cancelEditObservation = () => {
    setNoteEditId(null);
    setNoteText('');
  };

  const saveObservation = async (leadId: string) => {
    try {
      await updateDoc(doc(db, 'leads', leadId), { observacao: noteText });
      setLeads(prev => prev.map(l => (l.id === leadId ? { ...l, observacao: noteText } : l)));
      setNoteEditId(null);
      setNoteText('');
    } catch (e) {
      console.error('Falha ao salvar observação', e);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <h1>DGenny Conecta</h1>
          <div className="header-actions">
            <button
              type="button"
              className="header-add-btn"
              aria-label="Adicionar mensagem"
              onClick={() => setIsMessageModalOpen(true)}
              title="Adicionar sequência"
            >
              +
            </button>
            <button
              type="button"
              className="header-leads-btn"
              onClick={() => setShowLeadsManager(true)}
              aria-label="Leads"
              title="Gerenciar Leads"
            >
              ✅
            </button>
            <button
              type="button"
              className="header-profile-btn"
              onClick={() => setShowProfileModal(true)}
              aria-label="Perfil"
              title="Perfil"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#fff" d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8V22h19.2v-2.8c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
            </button>
            <button
              type="button"
              className="header-logout-btn"
              onClick={() => signOut(getAuth())}
              aria-label="Sair"
              title="Sair"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M16 13v-2H7V8l-5 4 5 4v-3zM20 3h-8v2h8v14h-8v2h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"></path>
              </svg>
            </button>
          </div>
        </div>
        <p>Sistema de Captura de Leads para Feira de Eventos</p>
      </header>

      <main className="app-main">
        <div className="container">
          <LeadForm 
            onSubmit={handleLeadSubmit}
            campaigns={campaigns}
            selectedCampaignId={selectedCampaignId}
            onCampaignChange={handleCampaignChange}
            onEditCampaign={handleEditCampaign}
            onDeleteCampaign={handleDeleteCampaign}
          />

          <OfflineStatus onLeadsChange={() => {
            // Recarregar TODOS os leads (Firebase + Offline) quando houver mudanças
            const loadAllLeads = async () => {
              setLeadsLoading(true);
              try {
                let allLeads: Lead[] = [];
                
                // Carregar leads offline primeiro
                const offlineLeads = await offlineService.getAllLeads();
                const offlineConverted = offlineLeads.map(ol => ({
                  id: ol.id,
                  nome: ol.nome,
                  empresa: ol.empresa,
                  telefone: ol.telefone,
                  createdAt: ol.createdAt,
                  sequenceName: 'Offline',
                  status: ol.status
                }));
                allLeads = [...offlineConverted];
                
                // Se online, carregar também do Firebase
                if (user?.uid) {
                  try {
                    const ref = collection(db, 'leads');
                    const q = query(ref, where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(20));
                    const snap = await getDocs(q);
                    const firebaseLeads: Lead[] = snap.docs.map(d => ({
                      id: d.id,
                      ...(d.data() as any),
                      createdAt: new Date(),
                      status: 'firebase'
                    }));
                    
                    // Combinar leads, evitando duplicatas por ID
                    const combinedLeads = [...allLeads];
                    firebaseLeads.forEach(fl => {
                      if (!combinedLeads.some(cl => cl.id === fl.id)) {
                        combinedLeads.push(fl);
                      }
                    });
                    allLeads = combinedLeads;
                  } catch (e) {
                    console.warn('Erro ao carregar leads do Firebase:', e);
                  }
                }
                
                // Ordenar por data mais recente
                allLeads.sort((a, b) => {
                  const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                  const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                  return dateB - dateA;
                });
                
                setLeads(allLeads.slice(0, 20)); // Limitar a 20 leads
                setLeadsHasMore(allLeads.length > 20);
              } catch (e) {
                console.error('Falha ao carregar leads:', e);
              } finally {
                setLeadsLoading(false);
              }
            };
            loadAllLeads();
          }} />

          <MessageCreator
            onAddCampaign={handleAddCampaign}
            onUpdateCampaign={handleUpdateCampaign}
            campaignToEdit={campaignToEdit}
            existingCampaigns={campaigns}
            isOpen={isMessageModalOpen}
            onClose={() => { setIsMessageModalOpen(false); setCampaignToEdit(null); }}
          />

          {showProfileModal && (
            <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h3>Perfil do Operador</h3>
                  <button type="button" className="close-btn" onClick={() => setShowProfileModal(false)}>×</button>
                </div>
                <div className="modal-body">
                  <div className="form-group">
                    <label>Nome</label>
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Seu nome"
                    />
                  </div>
                  <div className="form-group">
                    <label>Telefone (DDI)</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={profilePhone}
                      onChange={(e) => {
                        const d = e.target.value.replace(/\D/g, '').slice(0, 13);
                        const with55 = d.startsWith('55') ? d : ('55' + d.replace(/^55+/, ''));
                        setProfilePhone(with55.slice(0, 13));
                      }}
                      placeholder="55XXXXXXXXXXX"
                    />
                  </div>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={async () => {
                      const nameToSave = profileName.trim();
                      try {
                        // Salvar localmente para uso offline
                        localStorage.setItem('dgenny_profile', JSON.stringify({ name: nameToSave, phone: profilePhone }));
                      } catch {}
                      try {
                        if (user?.uid) {
                          await setDoc(doc(db, 'users', user.uid, 'profile', 'main'), {
                            name: nameToSave,
                            phone: profilePhone,
                            updatedAt: serverTimestamp()
                          }, { merge: true });
                        }
                      } catch (e) {
                        // eslint-disable-next-line no-console
                        console.error('Falha ao salvar perfil no Firestore (salvo localmente)', e);
                      }
                      setShowProfileModal(false);
                    }}
                  >
                    Salvar
                  </button>
                </div>
              </div>
            </div>
          )}

          <LeadsManager
            isOpen={showLeadsManager}
            onClose={() => setShowLeadsManager(false)}
          />
        </div>
      </main>
    </div>
  );
};

export default App;
