import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../firebase';
import './LeadsManager.css';

interface LeadData {
  id: string;
  nome: string;
  empresa: string;
  telefone: string;
  userId: string;
  userName?: string;
  sequenceName?: string;
  createdAt: Date;
  syncedAt?: Date;
}

interface UserStats {
  userId: string;
  userName: string;
  count: number;
}

interface CampaignInfo {
  id: string;
  name: string;
}

interface LeadsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const LeadsManager: React.FC<LeadsManagerProps> = ({ isOpen, onClose }) => {
  const [leads, setLeads] = useState<LeadData[]>([]);
  const [filteredLeads, setFilteredLeads] = useState<LeadData[]>([]);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [nameFilter, setNameFilter] = useState<string>('');
  const [campaignFilter, setCampaignFilter] = useState<string>('');

  const loadLeads = async () => {
    setLoading(true);
    setError('');
    
    try {
      const auth = getAuth();
      const currentUser = auth.currentUser;
      
      if (!currentUser?.uid) {
        throw new Error('Usuário não autenticado');
      }

      // Buscar todos os leads
      const leadsRef = collection(db, 'leads');
      const leadsQuery = query(leadsRef, orderBy('createdAt', 'desc'));
      const leadsSnapshot = await getDocs(leadsQuery);
      
      // Buscar todos os usuários para mapear nomes
      const usersRef = collection(db, 'users');
      const usersSnapshot = await getDocs(usersRef);
      
      // Criar mapa de userId -> userName
      const userNameMap: { [key: string]: string } = {};
      
      for (const userDoc of usersSnapshot.docs) {
        try {
          const profileRef = collection(db, 'users', userDoc.id, 'profile');
          const profileSnapshot = await getDocs(profileRef);
          
          if (!profileSnapshot.empty) {
            const profileData = profileSnapshot.docs[0].data();
            userNameMap[userDoc.id] = profileData?.name || 'Usuário sem nome';
          } else {
            userNameMap[userDoc.id] = 'Usuário sem nome';
          }
        } catch (e) {
          console.warn(`Erro ao buscar perfil do usuário ${userDoc.id}:`, e);
          userNameMap[userDoc.id] = 'Usuário sem nome';
        }
      }

      // Buscar TODAS as campanhas de TODOS os usuários para coletar localId
      const campaignNameMap: { [key: string]: string } = {};
      
      console.log('🔍 INICIANDO MAPEAMENTO DE CAMPANHAS DE TODOS OS USUÁRIOS');
      console.log('📌 IMPORTANTE: Match direto campaignId do lead = localId da campanha');
      console.log('⚠️ IGNORANDO userId dos leads (todos são null)');
      
      // Buscar TODOS os usuários da coleção /users para acessar suas campanhas
      console.log('🔍 Buscando TODOS os usuários da coleção /users...');
      
      const allUserIds = new Set<string>();
      
      // SOLUÇÃO ALTERNATIVA: Usar IDs conhecidos dos usuários (visto no Firebase Console)
      console.log('🔧 USANDO SOLUÇÃO ALTERNATIVA: IDs conhecidos dos usuários');
      
      // IDs dos usuários conhecidos do Firebase Console
      const knownUserIds = [
        'I8uiPjHgD1NhhuVwIOfgFQseKHM2',
        'IoshdKkerVhh8hucFrGUA53WTHa2', 
        '1PhiZBXDpfV8phFrXKKTauGToxS3'
      ];
      
      // Adicionar usuário logado se não estiver na lista
      const authInstance = getAuth();
      const loggedUser = authInstance.currentUser;
      if (loggedUser?.uid) {
        knownUserIds.push(loggedUser.uid);
        console.log(`👤 Usuário logado adicionado: ${loggedUser.uid}`);
      }
      
      // Remover duplicatas
      knownUserIds.forEach(userId => {
        allUserIds.add(userId);
        console.log(`👤 Usuário adicionado para busca: ${userId}`);
      });
      
      console.log('📝 NOTA: Contornando problema de busca na coleção /users');
      console.log('🎯 Buscando campanhas diretamente nos usuários conhecidos');
      
      console.log(`👥 Total de usuários únicos para buscar campanhas: ${allUserIds.size}`);
      console.log(`📋 UserIds para buscar campanhas:`, Array.from(allUserIds));
      
      // Buscar campanhas de TODOS os usuários
      for (const userId of Array.from(allUserIds)) {
        console.log(`\n🔄 Processando campanhas do usuário: ${userId}`);
        
        try {
          const campaignsRef = collection(db, 'users', userId, 'campaigns');
          console.log(`📂 Buscando em: users/${userId}/campaigns`);
          
          const campaignsSnapshot = await getDocs(campaignsRef);
          
          console.log(`📁 Campanhas encontradas para usuário ${userId}: ${campaignsSnapshot.docs.length}`);
          
          if (campaignsSnapshot.docs.length === 0) {
            console.log(`⚠️ Nenhuma campanha encontrada para usuário ${userId}`);
            console.log(`🔍 Verificando se o usuário ${userId} existe no Firebase...`);
          } else {
            console.log(`✅ Processando ${campaignsSnapshot.docs.length} campanhas do usuário ${userId}`);
          }
          
          campaignsSnapshot.docs.forEach((campaignDoc, index) => {
            const campaignData = campaignDoc.data();
            
            console.log(`📋 Campanha ${index + 1}/${campaignsSnapshot.docs.length} (usuário ${userId}):`, {
              docId: campaignDoc.id,
              localId: campaignData?.localId,
              nome: campaignData?.nome,
              allFields: Object.keys(campaignData || {})
            });
            
            // IMPORTANTE: O localId da campanha deve fazer match com campaignId do lead
            const localId = campaignData?.localId;
            const campaignName = campaignData?.nome || 'Sequência sem nome';
            
            if (localId) {
              campaignNameMap[localId] = campaignName;
              console.log(`✅ Mapeamento criado: localId="${localId}" -> nome="${campaignName}" (usuário: ${userId})`);
            } else {
              console.warn(`⚠️ Campanha sem localId: usuário=${userId}, docId=${campaignDoc.id}, nome=${campaignName}`);
              
              // Fallback: usar o docId se não houver localId
              campaignNameMap[campaignDoc.id] = campaignName;
              console.log(`🔄 Fallback mapeamento criado: docId="${campaignDoc.id}" -> nome="${campaignName}"`);
            }
          });
        } catch (e) {
          console.error(`❌ Erro ao buscar campanhas do usuário ${userId}:`, e);
          console.error(`❌ Detalhes do erro:`, {
            name: (e as any)?.name,
            message: (e as any)?.message,
            code: (e as any)?.code
          });
          
          // Verificar se é erro de permissão
          if ((e as any)?.code === 'permission-denied') {
            console.log(`🔒 ERRO DE PERMISSÃO para usuário ${userId} - pode não ter campanhas ou acesso negado`);
          }
        }
      }
      
      console.log('🗺️ MAPA FINAL DE CAMPANHAS:', campaignNameMap);
      console.log(`📊 Total de campanhas mapeadas: ${Object.keys(campaignNameMap).length}`);

      // Processar leads
      const allLeadsData: LeadData[] = leadsSnapshot.docs.map(doc => {
        const data = doc.data();
        const leadCampaignId = data.campaignId;
        const sequenceName = campaignNameMap[leadCampaignId] || 'Sem sequência';
        
        console.log(`🎯 Lead ${doc.id}:`, {
          nome: data.nome,
          campaignId: leadCampaignId,
          sequenceFound: sequenceName,
          availableCampaigns: Object.keys(campaignNameMap)
        });
        
        return {
          id: doc.id,
          nome: data.nome || '',
          empresa: data.empresa || '',
          telefone: data.telefone || '',
          userId: data.userId || '',
          userName: userNameMap[data.userId] || 'Usuário desconhecido',
          sequenceName: sequenceName,
          createdAt: data.createdAt?.toDate() || new Date(),
          syncedAt: data.syncedAt?.toDate()
        };
      });

      // Deduplicar leads por número de telefone (manter o mais recente)
      const phoneMap: { [key: string]: LeadData } = {};
      
      allLeadsData.forEach(lead => {
        const normalizedPhone = lead.telefone.replace(/\D/g, ''); // Remove formatação
        
        if (!phoneMap[normalizedPhone] || lead.createdAt > phoneMap[normalizedPhone].createdAt) {
          phoneMap[normalizedPhone] = lead;
        }
      });

      const leadsData = Object.values(phoneMap).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Calcular estatísticas por usuário (usando leads deduplicados)
      const statsMap: { [key: string]: UserStats } = {};
      
      leadsData.forEach(lead => {
        if (!statsMap[lead.userId]) {
          statsMap[lead.userId] = {
            userId: lead.userId,
            userName: lead.userName || 'Usuário desconhecido',
            count: 0
          };
        }
        statsMap[lead.userId].count++;
      });

      const stats = Object.values(statsMap).sort((a, b) => b.count - a.count);

      setLeads(leadsData);
      setFilteredLeads(leadsData);
      setUserStats(stats);
      
      // Criar lista de campanhas para exibição
      const campaignsList = Object.entries(campaignNameMap).map(([id, name]) => ({
        id,
        name
      }));
      setCampaigns(campaignsList);
      
    } catch (err) {
      console.error('Erro ao carregar leads:', err);
      setError('Erro ao carregar dados dos leads. Verifique sua conexão.');
    } finally {
      setLoading(false);
    }
  };

  // Função para aplicar filtros
  const applyFilters = () => {
    let filtered = leads;

    // Filtro por nome
    if (nameFilter.trim()) {
      filtered = filtered.filter(lead => 
        lead.nome.toLowerCase().includes(nameFilter.toLowerCase()) ||
        lead.empresa.toLowerCase().includes(nameFilter.toLowerCase()) ||
        lead.telefone.includes(nameFilter)
      );
    }

    // Filtro por campanha
    if (campaignFilter.trim()) {
      filtered = filtered.filter(lead => 
        lead.sequenceName === campaignFilter
      );
    }

    setFilteredLeads(filtered);
  };

  useEffect(() => {
    if (isOpen) {
      loadLeads();
    }
  }, [isOpen]);

  useEffect(() => {
    applyFilters();
  }, [nameFilter, campaignFilter, leads]);

  const formatDate = (date: Date) => {
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const openWhatsApp = (phone: string, name: string) => {
    // Limpar o número de telefone (remover espaços, parênteses, traços)
    const cleanPhone = phone.replace(/\D/g, '');
    
    // Adicionar código do país se não tiver (assumindo Brasil +55)
    let formattedPhone = cleanPhone;
    if (!cleanPhone.startsWith('55') && cleanPhone.length === 11) {
      formattedPhone = '55' + cleanPhone;
    } else if (!cleanPhone.startsWith('55') && cleanPhone.length === 10) {
      formattedPhone = '55' + cleanPhone;
    }
    
    // Mensagem padrão
    const message = `Olá ${name}, tudo bem?`;
    const encodedMessage = encodeURIComponent(message);
    
    // URL do WhatsApp
    const whatsappUrl = `https://wa.me/${formattedPhone}?text=${encodedMessage}`;
    
    // Abrir em nova aba
    window.open(whatsappUrl, '_blank');
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content leads-manager-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Gerenciador de Leads</h3>
          <button
            type="button"
            className="close-btn"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          {loading && (
            <div className="loading-message">
              <p>Carregando dados dos leads...</p>
            </div>
          )}

          {error && (
            <div className="error-message">
              <p>{error}</p>
              <button onClick={loadLeads} className="retry-btn">
                Tentar novamente
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Lista de campanhas */}
              <div className="campaigns-section">
                <h4>Campanhas Disponíveis ({campaigns.length} total)</h4>
                <div className="campaigns-list">
                  {campaigns.length > 0 ? (
                    <div className="campaigns-grid">
                      {campaigns.map(campaign => (
                        <div key={campaign.id} className="campaign-card">
                          <div className="campaign-id">ID: {campaign.id}</div>
                          <div className="campaign-name">{campaign.name}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="no-campaigns">
                      <p>Nenhuma campanha encontrada</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Estatísticas por usuário */}
              <div className="user-stats-section">
                <h4>Leads por Usuário</h4>
                <div className="user-stats-grid">
                  {userStats.map(stat => (
                    <div key={stat.userId} className="user-stat-card">
                      <div className="user-name">{stat.userName}</div>
                      <div className="user-count">{stat.count} leads</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Filtros */}
              <div className="filters-section">
                <h4>Filtros</h4>
                <div className="filters-grid">
                  <div className="filter-group">
                    <label htmlFor="nameFilter">Buscar por Nome/Empresa/Telefone:</label>
                    <input
                      id="nameFilter"
                      type="text"
                      value={nameFilter}
                      onChange={(e) => setNameFilter(e.target.value)}
                      placeholder="Digite para filtrar..."
                      className="filter-input"
                    />
                  </div>
                  <div className="filter-group">
                    <label htmlFor="campaignFilter">Filtrar por Campanha:</label>
                    <select
                      id="campaignFilter"
                      value={campaignFilter}
                      onChange={(e) => setCampaignFilter(e.target.value)}
                      className="filter-select"
                    >
                      <option value="">Todas as campanhas</option>
                      {campaigns.map(campaign => (
                        <option key={campaign.id} value={campaign.name}>
                          {campaign.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="filter-actions">
                    <button 
                      onClick={() => {
                        setNameFilter('');
                        setCampaignFilter('');
                      }}
                      className="clear-filters-btn"
                    >
                      Limpar Filtros
                    </button>
                  </div>
                </div>
              </div>

              {/* Lista de leads */}
              <div className="leads-list-section">
                <h4>Lista de Leads ({filteredLeads.length} de {leads.length} total)</h4>
                <div className="leads-table-container">
                  <table className="leads-table">
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th>Empresa</th>
                        <th>Telefone</th>
                        <th>Usuário</th>
                        <th>Sequência</th>
                        <th>Data/Hora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeads.map(lead => (
                        <tr key={lead.id}>
                          <td>
                            <span 
                              className="lead-name-link"
                              onClick={() => openWhatsApp(lead.telefone, lead.nome)}
                              title={`Abrir WhatsApp com ${lead.nome}`}
                            >
                              {lead.nome}
                            </span>
                          </td>
                          <td>{lead.empresa}</td>
                          <td>{lead.telefone}</td>
                          <td>{lead.userName}</td>
                          <td>{lead.sequenceName}</td>
                          <td>{formatDate(lead.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={loadLeads}
            disabled={loading}
          >
            🔄 Atualizar
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default LeadsManager;
