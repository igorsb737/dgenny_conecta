import React, { useState, useEffect } from 'react';
import { syncService, ConnectivityStatus } from '../services/syncService';
import { offlineService, OfflineStats, OfflineLead } from '../services/offlineService';
import './OfflineStatus.css';

interface OfflineStatusProps {
  onLeadsChange?: () => void;
}

const OfflineStatus: React.FC<OfflineStatusProps> = ({ onLeadsChange }) => {
  const [stats, setStats] = useState<OfflineStats>({ pending: 0, sent: 0, failed: 0, total: 0 });
  const [connectivity, setConnectivity] = useState<ConnectivityStatus>({
    isOnline: navigator.onLine,
    lastCheck: new Date(),
    firebaseReachable: false
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [allLeads, setAllLeads] = useState<OfflineLead[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    loadStats();
    
    // Escutar mudanças de conectividade
    const unsubscribe = syncService.onConnectivityChange((status) => {
      setConnectivity(status);
    });

    // Verificar conectividade inicial
    syncService.checkConnectivity();

    // Atualizar stats a cada 5 segundos
    const interval = setInterval(loadStats, 5000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const loadStats = async () => {
    try {
      const newStats = await offlineService.getStats();
      setStats(newStats);
      
      // SEMPRE carregar leads para exibir na lista
      const leads = await offlineService.getAllLeads();
      setAllLeads(leads);
    } catch (error) {
      console.error('Erro ao carregar stats:', error);
    }
  };

  const handleForceSync = async () => {
    setIsLoading(true);
    try {
      const result = await syncService.forceSyncAll();
      
      if (result.processed > 0) {
        showMessage('success', `${result.processed} leads sincronizados com sucesso!`);
        onLeadsChange?.();
      } else if (result.errors > 0) {
        showMessage('error', `Erro ao sincronizar ${result.errors} leads`);
      } else {
        showMessage('info', 'Nenhum lead pendente para sincronizar');
      }
      
      await loadStats();
    } catch (error) {
      showMessage('error', `Erro ao sincronizar: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearSent = async () => {
    if (!window.confirm('Tem certeza que deseja limpar todos os leads já enviados?')) {
      return;
    }

    setIsLoading(true);
    try {
      const result = await offlineService.clearSentLeads();
      
      if (result > 0) {
        showMessage('success', `${result} leads enviados foram removidos`);
        onLeadsChange?.();
      } else {
        showMessage('info', 'Nenhum lead enviado para remover');
      }
      
      await loadStats();
    } catch (error) {
      showMessage('error', `Erro ao limpar leads: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async (type: 'all' | 'sent' = 'all') => {
    setIsLoading(true);
    try {
      const leads = await offlineService.getAllLeads();
      const filteredLeads = type === 'sent' ? leads.filter(lead => lead.status === 'sent') : leads;
      
      if (filteredLeads.length === 0) {
        showMessage('info', 'Nenhum lead para exportar');
        return;
      }

      const csvContent = [
        'Nome,Empresa,Telefone,Status,Data de Criação',
        ...filteredLeads.map(lead => 
          `"${lead.nome}","${lead.empresa}","${lead.telefone}","${lead.status}","${lead.createdAt.toLocaleString('pt-BR')}"`
        )
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `leads_${type}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      showMessage('success', `${filteredLeads.length} leads exportados com sucesso!`);
    } catch (error) {
      console.error('Erro ao exportar leads:', error);
      showMessage('error', 'Erro ao exportar leads');
    } finally {
      setIsLoading(false);
    }
  };

  const showMessage = (type: 'success' | 'error' | 'info', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  return (
    <div className="offline-status">
      <div className="status-header">
        <div className="status-info">
          <span className={`status-indicator ${connectivity.isOnline ? 'online' : 'offline'}`}>
            {connectivity.isOnline ? '🌐' : '📱'} {connectivity.isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        <button
          className="details-toggle"
          aria-label={showDetails ? 'Esconder detalhes' : 'Expandir detalhes'}
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? 'Esconder' : 'Expandir'}
        </button>
      </div>

      {showDetails && (
        <div className="status-details">
          {message && (
            <div className={`status-message ${message.type}`}>
              {message.type === 'success' ? '✅' : message.type === 'error' ? '❌' : 'ℹ️'} {message.text}
            </div>
          )}

          <div className="stats-grid">
            <div className="stat-item pending">
              <span className="stat-icon">⏳</span>
              <div className="stat-info">
                <span className="stat-number">{stats.pending}</span>
                <span className="stat-label">Pendentes</span>
              </div>
            </div>
            
            <div className="stat-item sent">
              <span className="stat-icon">✅</span>
              <div className="stat-info">
                <span className="stat-number">{stats.sent}</span>
                <span className="stat-label">Enviados</span>
              </div>
            </div>
            
            <div className="stat-item failed">
              <span className="stat-icon">❌</span>
              <div className="stat-info">
                <span className="stat-number">{stats.failed}</span>
                <span className="stat-label">Com Erro</span>
              </div>
            </div>
            
            <div className="stat-item total">
              <span className="stat-icon">📊</span>
              <div className="stat-info">
                <span className="stat-number">{stats.total}</span>
                <span className="stat-label">Total</span>
              </div>
            </div>
          </div>

          <div className="action-buttons">
            <button 
              className="sync-btn"
              onClick={handleForceSync}
              disabled={isLoading || !connectivity.isOnline}
              title={!connectivity.isOnline ? 'Sem conexão' : 'Forçar sincronização'}
            >
              {isLoading ? '🔄' : '📤'} Sincronizar Agora
            </button>
            
            <button 
              className="clear-btn"
              onClick={handleClearSent}
              disabled={isLoading || stats.sent === 0}
              title="Limpar leads enviados"
            >
              🗑️ Limpar Enviados ({stats.sent})
            </button>
          </div>

          <div className="export-buttons">
            <button 
              className="export-btn"
              onClick={() => handleExport('all')}
              disabled={isLoading || stats.total === 0}
              title="Exportar todos os leads"
            >
              📥 Exportar Todos
            </button>
            
            <button 
              className="export-btn"
              onClick={() => handleExport('sent')}
              disabled={isLoading || stats.sent === 0}
              title="Exportar apenas leads enviados"
            >
              📥 Exportar Enviados
            </button>
          </div>

          {/* Lista de leads dentro do status details */}
          <div className="leads-list-section">
            <h4>Leads do Banco Local</h4>
            <div className="leads-list">
              {allLeads.length === 0 ? (
                <div className="no-leads">Nenhum lead encontrado</div>
              ) : (
                allLeads.map((lead: OfflineLead) => (
                  <div key={lead.id} className="lead-item-offline">
                    <div className="lead-info">
                      <div className="lead-name">{lead.nome}</div>
                      <div className="lead-company">{lead.empresa}</div>
                      <div className="lead-phone">{lead.telefone}</div>
                    </div>
                    <div className={`lead-status ${lead.status}`}>
                      {lead.status === 'pending' && '⏳ Pendente'}
                      {lead.status === 'sent' && '✅ Enviado'}
                      {lead.status === 'failed' && '❌ Erro'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfflineStatus;
