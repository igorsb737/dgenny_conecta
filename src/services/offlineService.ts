export interface OfflineLead {
  id: string;
  nome: string;
  empresa: string;
  telefone: string;
  campaignId?: string;
  crmProvider?: string;
  crmStage?: string;
  status: 'pending' | 'sent' | 'failed';
  createdAt: Date;
  lastAttempt?: Date;
  attempts: number;
  error?: string;
}

export interface OfflineStats {
  pending: number;
  sent: number;
  failed: number;
  total: number;
}

export interface OfflineCampaign {
  id: string;
  nome: string;
  mensagens: any[];
  crmProvider?: string;
  crmStage?: string;
  createdAt: Date;
  syncedAt?: Date;
}

class OfflineService {
  private dbName = 'DgennyConectaDB';
  private version = 2;
  private leadsStoreName = 'leads';
  private campaignsStoreName = 'campaigns';
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('Erro ao abrir IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ IndexedDB inicializado com sucesso');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Store para leads
        if (!db.objectStoreNames.contains(this.leadsStoreName)) {
          const leadsStore = db.createObjectStore(this.leadsStoreName, { keyPath: 'id' });
          leadsStore.createIndex('status', 'status', { unique: false });
          leadsStore.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('📦 Object store criado:', this.leadsStoreName);
        }
        
        // Store para campanhas
        if (!db.objectStoreNames.contains(this.campaignsStoreName)) {
          const campaignsStore = db.createObjectStore(this.campaignsStoreName, { keyPath: 'id' });
          campaignsStore.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('📦 Object store criado:', this.campaignsStoreName);
        }
      };
    });
  }

  private async ensureDB(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    return this.db!;
  }

  async saveLead(lead: Omit<OfflineLead, 'id' | 'createdAt' | 'attempts' | 'status'>): Promise<string> {
    const db = await this.ensureDB();
    const id = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const offlineLead: OfflineLead = {
      ...lead,
      id,
      createdAt: new Date(),
      attempts: 0,
      status: 'pending'
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.leadsStoreName], 'readwrite');
      const store = transaction.objectStore(this.leadsStoreName);
      const request = store.add(offlineLead);

      request.onsuccess = () => {
        console.log('💾 Lead salvo offline:', id);
        resolve(id);
      };

      request.onerror = () => {
        console.error('❌ Erro ao salvar lead offline:', request.error);
        reject(request.error);
      };
    });
  }

  async updateLeadStatus(id: string, status: OfflineLead['status'], error?: string): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.leadsStoreName], 'readwrite');
      const store = transaction.objectStore(this.leadsStoreName);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const lead = getRequest.result as OfflineLead;
        if (!lead) {
          reject(new Error('Lead não encontrado'));
          return;
        }

        lead.status = status;
        lead.lastAttempt = new Date();
        if (status === 'failed') {
          lead.attempts += 1;
          lead.error = error;
        } else if (status === 'sent') {
          lead.error = undefined;
        }

        const updateRequest = store.put(lead);
        updateRequest.onsuccess = () => {
          console.log(`📝 Status do lead ${id} atualizado para: ${status}`);
          resolve();
        };
        updateRequest.onerror = () => reject(updateRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  async getPendingLeads(): Promise<OfflineLead[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.leadsStoreName], 'readonly');
      const store = transaction.objectStore(this.leadsStoreName);
      const index = store.index('status');
      const request = index.getAll('pending');

      request.onsuccess = () => {
        const leads = request.result as OfflineLead[];
        // Ordenar por data de criação (mais antigos primeiro)
        leads.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        resolve(leads);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getFailedLeads(): Promise<OfflineLead[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.leadsStoreName], 'readonly');
      const store = transaction.objectStore(this.leadsStoreName);
      const index = store.index('status');
      const request = index.getAll('failed');

      request.onsuccess = () => {
        const leads = request.result as OfflineLead[];
        // Ordenar por última tentativa (mais antigos primeiro para retry)
        leads.sort((a, b) => {
          const aTime = a.lastAttempt?.getTime() || a.createdAt.getTime();
          const bTime = b.lastAttempt?.getTime() || b.createdAt.getTime();
          return aTime - bTime;
        });
        resolve(leads);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getAllLeads(): Promise<OfflineLead[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.leadsStoreName], 'readonly');
      const store = transaction.objectStore(this.leadsStoreName);
      const request = store.getAll();

      request.onsuccess = () => {
        const leads = request.result as OfflineLead[];
        // Ordenar por data de criação (mais recentes primeiro)
        leads.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        resolve(leads);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async getStats(): Promise<OfflineStats> {
    const leads = await this.getAllLeads();
    
    const stats = leads.reduce((acc, lead) => {
      acc[lead.status]++;
      acc.total++;
      return acc;
    }, { pending: 0, sent: 0, failed: 0, total: 0 });

    return stats;
  }

  async clearSentLeads(): Promise<number> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.leadsStoreName], 'readwrite');
      const store = transaction.objectStore(this.leadsStoreName);
      const index = store.index('status');
      const request = index.getAll('sent');

      request.onsuccess = () => {
        const sentLeads = request.result as OfflineLead[];
        let deletedCount = 0;

        if (sentLeads.length === 0) {
          resolve(0);
          return;
        }

        sentLeads.forEach((lead) => {
          const deleteRequest = store.delete(lead.id);
          deleteRequest.onsuccess = () => {
            deletedCount++;
            if (deletedCount === sentLeads.length) {
              console.log(`🗑️ ${deletedCount} leads enviados removidos do armazenamento local`);
              resolve(deletedCount);
            }
          };
          deleteRequest.onerror = () => reject(deleteRequest.error);
        });
      };

      request.onerror = () => reject(request.error);
    });
  }

  async deleteLead(id: string): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.leadsStoreName], 'readwrite');
      const store = transaction.objectStore(this.leadsStoreName);
      const request = store.delete(id);

      request.onsuccess = () => {
        console.log(`🗑️ Lead ${id} removido`);
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async exportLeads(status?: OfflineLead['status']): Promise<string> {
    let leads: OfflineLead[];
    
    if (status) {
      switch (status) {
        case 'pending':
          leads = await this.getPendingLeads();
          break;
        case 'failed':
          leads = await this.getFailedLeads();
          break;
        case 'sent':
          const allLeads = await this.getAllLeads();
          leads = allLeads.filter(lead => lead.status === 'sent');
          break;
        default:
          leads = await this.getAllLeads();
      }
    } else {
      leads = await this.getAllLeads();
    }

    // Converter para CSV
    const headers = ['ID', 'Nome', 'Empresa', 'Telefone', 'Status', 'Criado em', 'Última tentativa', 'Tentativas', 'Erro'];
    const csvContent = [
      headers.join(','),
      ...leads.map(lead => [
        lead.id,
        `"${lead.nome}"`,
        `"${lead.empresa}"`,
        lead.telefone,
        lead.status,
        lead.createdAt.toISOString(),
        lead.lastAttempt?.toISOString() || '',
        lead.attempts.toString(),
        `"${lead.error || ''}"`
      ].join(','))
    ].join('\n');

    return csvContent;
  }

  // Métodos para campanhas
  async saveCampaigns(campaigns: OfflineCampaign[]): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.campaignsStoreName], 'readwrite');
      const store = transaction.objectStore(this.campaignsStoreName);
      
      let completed = 0;
      const total = campaigns.length;

      if (total === 0) {
        resolve();
        return;
      }

      campaigns.forEach(campaign => {
        const offlineCampaign: OfflineCampaign = {
          ...campaign,
          createdAt: new Date(),
          syncedAt: new Date()
        };

        const request = store.put(offlineCampaign);
        
        request.onsuccess = () => {
          completed++;
          if (completed === total) {
            console.log(`💾 ${total} campanhas salvas offline`);
            resolve();
          }
        };
        
        request.onerror = () => reject(request.error);
      });
    });
  }

  async getCampaigns(): Promise<OfflineCampaign[]> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.campaignsStoreName], 'readonly');
      const store = transaction.objectStore(this.campaignsStoreName);
      const request = store.getAll();

      request.onsuccess = () => {
        const campaigns = request.result as OfflineCampaign[];
        // Ordenar por data de criação (mais recentes primeiro)
        campaigns.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        resolve(campaigns);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async clearCampaigns(): Promise<void> {
    const db = await this.ensureDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.campaignsStoreName], 'readwrite');
      const store = transaction.objectStore(this.campaignsStoreName);
      const request = store.clear();

      request.onsuccess = () => {
        console.log('🗑️ Campanhas offline limpas');
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }
}

export const offlineService = new OfflineService();
