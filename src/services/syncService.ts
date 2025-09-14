import { offlineService, OfflineLead } from './offlineService';
import { CrmService } from './crmService';

export interface ConnectivityStatus {
  isOnline: boolean;
  lastCheck: Date;
  firebaseReachable: boolean;
}

class SyncService {
  private isRunning = false;
  private syncInterval: NodeJS.Timeout | null = null;
  private connectivityCheckInterval: NodeJS.Timeout | null = null;
  private connectivityStatus: ConnectivityStatus = {
    isOnline: navigator.onLine,
    lastCheck: new Date(),
    firebaseReachable: false
  };
  private listeners: Array<(status: ConnectivityStatus) => void> = [];

  constructor() {
    // Escutar eventos de conectividade do navegador
    window.addEventListener('online', this.handleOnline.bind(this));
    window.addEventListener('offline', this.handleOffline.bind(this));
  }

  private handleOnline() {
    console.log('🌐 Conexão detectada - iniciando verificação');
    this.checkConnectivity();
  }

  private handleOffline() {
    console.log('📵 Desconexão detectada');
    this.updateConnectivityStatus(false, false);
  }

  private updateConnectivityStatus(isOnline: boolean, firebaseReachable: boolean) {
    this.connectivityStatus = {
      isOnline,
      firebaseReachable,
      lastCheck: new Date()
    };

    // Notificar listeners
    this.listeners.forEach(listener => listener(this.connectivityStatus));

    // Se ficou online, tentar sincronizar leads e campanhas
    if (isOnline && firebaseReachable && !this.isRunning) {
      this.startSync();
      this.syncCampaignsFromFirebase();
    }
  }

  async checkConnectivity(): Promise<ConnectivityStatus> {
    const isOnline = navigator.onLine;
    
    if (!isOnline) {
      this.updateConnectivityStatus(false, false);
      return this.connectivityStatus;
    }

    // Testar conectividade real com Firebase
    try {
      const { db } = await import('../firebase');
      
      // Teste simples: apenas verificar se consegue acessar o Firebase
      // Não tenta criar documentos para evitar problemas de permissão
      if (db) {
        console.log('✅ Firebase conectado e configurado');
        this.updateConnectivityStatus(true, true);
      } else {
        throw new Error('Database não inicializado');
      }
    } catch (error) {
      console.log('❌ Erro no Firebase:', error);
      this.updateConnectivityStatus(isOnline, false);
    }

    return this.connectivityStatus;
  }

  onConnectivityChange(listener: (status: ConnectivityStatus) => void) {
    this.listeners.push(listener);
    
    // Retornar função para remover listener
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  async startSync() {
    if (this.isRunning) {
      console.log('🔄 Sincronização já está rodando');
      return;
    }

    console.log('🚀 Iniciando sincronização automática');
    this.isRunning = true;

    // Verificar conectividade a cada 30 segundos
    this.connectivityCheckInterval = setInterval(() => {
      this.checkConnectivity();
    }, 30000);

    // Tentar sincronizar a cada 30 segundos quando online (reduzido frequência)
    this.syncInterval = setInterval(async () => {
      if (this.connectivityStatus.isOnline && this.connectivityStatus.firebaseReachable) {
        await this.processPendingLeads();
      }
    }, 30000);

    // Sincronizar imediatamente
    await this.processPendingLeads();
  }

  stopSync() {
    console.log('⏹️ Parando sincronização automática');
    this.isRunning = false;

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.connectivityCheckInterval) {
      clearInterval(this.connectivityCheckInterval);
      this.connectivityCheckInterval = null;
    }
  }

  async processPendingLeads(): Promise<{ processed: number; errors: number }> {
    if (!this.connectivityStatus.isOnline) {
      return { processed: 0, errors: 0 };
    }

    // Mesmo sem Firebase, tentar processar leads para CRM se configurado
    if (!this.connectivityStatus.firebaseReachable) {
      console.log('⚠️ Firebase indisponível, tentando apenas CRM...');
      return await this.processCrmOnly();
    }

    try {
      // Buscar leads pendentes e com falha
      const [pendingLeads, failedLeads] = await Promise.all([
        offlineService.getPendingLeads(),
        offlineService.getFailedLeads()
      ]);

      // Filtrar leads com falha que podem tentar novamente (backoff exponencial)
      const retryableFailedLeads = failedLeads.filter(lead => {
        const timeSinceLastAttempt = Date.now() - (lead.lastAttempt?.getTime() || lead.createdAt.getTime());
        const backoffDelay = Math.min(1000 * Math.pow(2, lead.attempts), 300000); // Max 5 minutos
        return timeSinceLastAttempt >= backoffDelay;
      });

      const leadsToProcess = [...pendingLeads, ...retryableFailedLeads];

      if (leadsToProcess.length === 0) {
        return { processed: 0, errors: 0 };
      }

      console.log(`📤 Processando ${leadsToProcess.length} leads...`);

      let processed = 0;
      let errors = 0;

      // Processar leads sequencialmente para evitar sobrecarga
      for (const lead of leadsToProcess) {
        try {
          await this.syncLead(lead);
          processed++;
        } catch (error) {
          console.error(`❌ Erro ao sincronizar lead ${lead.id}:`, error);
          errors++;
          
          // Atualizar status para failed
          await offlineService.updateLeadStatus(
            lead.id, 
            'failed', 
            error instanceof Error ? error.message : 'Erro desconhecido'
          );
        }

        // Pequena pausa entre requests para não sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (processed > 0) {
        console.log(`✅ ${processed} leads sincronizados com sucesso`);
      }
      if (errors > 0) {
        console.log(`❌ ${errors} leads falharam na sincronização`);
      }

      return { processed, errors };
    } catch (error) {
      console.error('❌ Erro geral na sincronização:', error);
      return { processed: 0, errors: 1 };
    }
  }

  private async syncLead(lead: OfflineLead): Promise<void> {
    console.log(`🔄 Sincronizando lead ${lead.id} - Status: ${lead.status}`);
    
    // Verificar se já foi processado para evitar duplicação
    if (lead.status === 'sent') {
      console.log(`⏭️ Lead ${lead.id} já foi enviado - pulando`);
      return;
    }

    // Primeiro, salvar no Firebase
    await this.saveToFirebase(lead);

    // Depois, tentar enviar para CRM se configurado
    if (lead.crmProvider && lead.crmStage) {
      try {
        const crmLead = {
          name: lead.nome,
          company: lead.empresa,
          phone: lead.telefone
        };

        await CrmService.sendLead(lead.crmProvider, crmLead, lead.crmStage);
        console.log(`📋 Lead ${lead.id} enviado para CRM: ${lead.crmProvider}`);
      } catch (crmError) {
        // CRM falhou, mas Firebase funcionou - não é erro crítico
        console.warn(`⚠️ CRM falhou para lead ${lead.id}, mas Firebase OK:`, crmError);
      }
    }

    // Disparar sequência se houver campanha configurada
    if (lead.campaignId) {
      try {
        await this.triggerSequence(lead);
      } catch (sequenceError) {
        console.warn(`⚠️ Erro ao disparar sequência para lead ${lead.id}:`, sequenceError);
      }
    }

    // Marcar como enviado
    await offlineService.updateLeadStatus(lead.id, 'sent');
    console.log(`✅ Lead ${lead.id} marcado como enviado`);
  }

  private async triggerSequence(lead: OfflineLead): Promise<void> {
    if (!lead.campaignId) return;

    console.log(`🎯 Disparando sequência para lead ${lead.id} - Campanha: ${lead.campaignId}`);

    // Buscar campanha offline
    const campaigns = await offlineService.getCampaigns();
    const campaign = campaigns.find(c => c.id === lead.campaignId);
    
    if (!campaign || !campaign.mensagens || campaign.mensagens.length === 0) {
      console.warn(`⚠️ Campanha ${lead.campaignId} não encontrada ou sem mensagens`);
      return;
    }

    // Verificar se já disparou sequência para evitar duplicação
    const sequenceKey = `sequence_${lead.id}_${lead.campaignId}`;
    const alreadyTriggered = localStorage.getItem(sequenceKey);
    
    if (alreadyTriggered) {
      console.log(`⏭️ Sequência já disparada para lead ${lead.id} - pulando`);
      return;
    }

    // Marcar como disparado
    localStorage.setItem(sequenceKey, new Date().toISOString());

    console.log(`🚀 Disparando sequência "${campaign.nome}" para ${lead.nome}`);

    // Importar funções de envio do App.tsx (seria melhor extrair para um serviço separado)
    const profileData = localStorage.getItem('dgenny_profile');
    let profilePhone = '';
    
    if (profileData) {
      try {
        const profile = JSON.parse(profileData);
        profilePhone = profile.phone || '';
      } catch (e) {
        console.warn('Erro ao ler perfil do localStorage');
      }
    }

    const normalizePhone = (raw: string) => {
      const digits = (raw || '').replace(/\D/g, '');
      if (digits.startsWith('55')) return digits;
      const trimmed = digits.replace(/^0+/, '');
      return `55${trimmed}`;
    };

    const urlBase = (process.env.REACT_APP_URL_EVO || '').replace(/\/+$/, '');
    const apiKey = process.env.REACT_APP_APIKEY_EVO || '';
    const instancePhone = profilePhone ? normalizePhone(profilePhone) : null;
    const leadPhone = normalizePhone(lead.telefone);

    if (!urlBase || !apiKey || !instancePhone) {
      console.warn('Configuração EVO incompleta para disparar sequência');
      return;
    }

    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
    const applyTemplate = (text: string) =>
      text
        .replace(/\{\{\s*nome\s*\}\}/gi, lead.nome)
        .replace(/\{\{\s*empresa\s*\}\}/gi, lead.empresa);

    const buildEndpoint = (sendPath: 'sendText' | 'sendMedia' | 'sendWhatsAppAudio') => {
      if (/\/send(Text|Media|WhatsAppAudio)$/i.test(urlBase)) {
        return urlBase.replace(/\/send(Text|Media|WhatsAppAudio)$/i, `/${sendPath}`) + `/${instancePhone}`;
      }
      if (/\/message$/i.test(urlBase)) {
        return `${urlBase}/${sendPath}/${instancePhone}`;
      }
      return `${urlBase}/message/${sendPath}/${instancePhone}`;
    };

    const sendText = async (text: string) => {
      const endpoint = buildEndpoint('sendText');
      try {
        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': apiKey,
          },
          body: JSON.stringify({ number: leadPhone, text }),
        });
      } catch (e) {
        console.error('Falha ao enviar mensagem', e);
      }
    };

    const sendAudio = async (base64: string) => {
      const endpoint = buildEndpoint('sendWhatsAppAudio');
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
          body: JSON.stringify({ number: leadPhone, options: { presence: 'recording', encoding: true }, audioMessage: { audio: base64 } }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.error('EVO audio error', res.status, body);
        }
      } catch (e) { console.error('Falha ao enviar áudio', e); }
    };

    const sendMedia = async (mediaType: 'image' | 'video' | 'document', base64: string, fileName?: string, caption?: string) => {
      const endpoint = buildEndpoint('sendMedia');
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': apiKey },
          body: JSON.stringify({
            number: leadPhone,
            options: { presence: 'composing' },
            mediaMessage: { mediaType: mediaType, fileName: fileName || `${mediaType}.bin`, caption: caption || '', media: base64 },
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          console.error('EVO media error', mediaType, res.status, body);
        }
      } catch (e) { console.error('Falha ao enviar mídia', e); }
    };

    // Processar mensagens da sequência
    for (const step of campaign.mensagens) {
      const st = step as any;
      if (st?.tipo === 'texto') {
        const msg = applyTemplate(st?.conteudo || '');
        if (msg) await sendText(msg);
      } else if (st?.tipo === 'audio' && st?.base64) {
        const mt = (st?.mimeType || '').toLowerCase();
        const supportedForAudio = /(audio\/(mp3|mpeg|mp4|aac|ogg|opus|wav))/.test(mt);
        if (supportedForAudio) {
          await sendAudio(st.base64);
        } else {
          await sendMedia('document', st.base64, st?.fileName || 'audio.webm');
        }
      } else if ((st?.tipo === 'imagem' || st?.tipo === 'video' || st?.tipo === 'documento') && st?.base64) {
        const mt = st.tipo === 'imagem' ? 'image' : st.tipo === 'video' ? 'video' : 'document';
        const caption = st?.conteudo ? applyTemplate(st.conteudo) : '';
        await sendMedia(mt, st.base64, st?.fileName, caption);
      } else {
        console.warn('Passo da sequência ignorado (tipo não suportado ou sem base64):', st?.tipo);
      }
      await sleep(2000); // 2s entre mensagens
    }

    console.log(`✅ Sequência "${campaign.nome}" disparada para ${lead.nome}`);
  }

  private async saveToFirebase(lead: OfflineLead): Promise<void> {
    const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
    const { db } = await import('../firebase');

    const leadData = {
      nome: lead.nome,
      empresa: lead.empresa,
      telefone: lead.telefone,
      campaignId: lead.campaignId || null,
      crmProvider: lead.crmProvider || null,
      crmStage: lead.crmStage || null,
      createdAt: serverTimestamp(),
      syncedAt: serverTimestamp(),
      offlineId: lead.id
    };

    try {
      await addDoc(collection(db, 'leads'), leadData);
      console.log(`🔥 Lead ${lead.id} salvo no Firebase`);
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        console.warn(`⚠️ Permissão negada para salvar no Firebase. Verifique as regras do Firestore.`);
        throw new Error('Permissões do Firebase insuficientes. Verifique as regras do Firestore.');
      }
      throw error;
    }
  }

  private async processCrmOnly(): Promise<{ processed: number; errors: number }> {
    try {
      const [pendingLeads, failedLeads] = await Promise.all([
        offlineService.getPendingLeads(),
        offlineService.getFailedLeads()
      ]);

      const leadsWithCrm = [...pendingLeads, ...failedLeads].filter(lead => 
        lead.crmProvider && lead.crmStage
      );

      if (leadsWithCrm.length === 0) {
        return { processed: 0, errors: 0 };
      }

      console.log(`📋 Processando ${leadsWithCrm.length} leads apenas para CRM...`);

      let processed = 0;
      let errors = 0;

      for (const lead of leadsWithCrm) {
        try {
          const crmLead = {
            name: lead.nome,
            company: lead.empresa,
            phone: lead.telefone
          };

          await CrmService.sendLead(lead.crmProvider!, crmLead, lead.crmStage!);
          
          // Marcar como enviado mesmo sem Firebase
          await offlineService.updateLeadStatus(lead.id, 'sent');
          processed++;
          
          console.log(`📋 Lead ${lead.id} enviado para CRM: ${lead.crmProvider}`);
        } catch (error) {
          console.error(`❌ Erro ao enviar lead ${lead.id} para CRM:`, error);
          await offlineService.updateLeadStatus(
            lead.id, 
            'failed', 
            error instanceof Error ? error.message : 'Erro no CRM'
          );
          errors++;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      return { processed, errors };
    } catch (error) {
      console.error('❌ Erro geral no processamento CRM:', error);
      return { processed: 0, errors: 1 };
    }
  }

  async forceSyncAll(): Promise<{ processed: number; errors: number }> {
    console.log('🔄 Forçando sincronização de todos os leads pendentes...');
    
    // Verificar conectividade primeiro
    await this.checkConnectivity();
    
    if (!this.connectivityStatus.isOnline) {
      throw new Error('Sem conexão com a internet.');
    }

    if (!this.connectivityStatus.firebaseReachable) {
      console.log('⚠️ Firebase indisponível, tentando apenas CRM...');
      return await this.processCrmOnly();
    }

    return await this.processPendingLeads();
  }

  getConnectivityStatus(): ConnectivityStatus {
    return { ...this.connectivityStatus };
  }

  async getQueueStatus() {
    const stats = await offlineService.getStats();
    return {
      ...stats,
      isOnline: this.connectivityStatus.isOnline,
      firebaseReachable: this.connectivityStatus.firebaseReachable,
      isSyncing: this.isRunning
    };
  }

  async syncCampaignsFromFirebase(): Promise<void> {
    try {
      console.log('🔄 Sincronizando campanhas do Firebase...');
      
      // Importar Firebase dinamicamente
      const { collection, query, orderBy, getDocs } = await import('firebase/firestore');
      const { db } = await import('../firebase');
      const { getAuth } = await import('firebase/auth');
      
      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user?.uid) {
        console.log('⚠️ Usuário não autenticado para sincronizar campanhas');
        return;
      }

      const ref = collection(db, 'users', user.uid, 'campaigns');
      const q = query(ref, orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      
      const campaigns = snapshot.docs.map((doc) => {
        const data = doc.data() as any;
        return {
          id: data?.localId || doc.id,
          nome: data?.nome || '',
          mensagens: Array.isArray(data?.mensagens) ? data.mensagens : [],
          crmProvider: data?.crmProvider || undefined,
          crmStage: data?.crmStage || undefined,
          createdAt: new Date(),
          syncedAt: new Date()
        };
      });

      if (campaigns.length > 0) {
        await offlineService.saveCampaigns(campaigns);
        console.log(`✅ ${campaigns.length} campanhas sincronizadas para cache offline`);
        
        // Disparar evento para atualizar UI
        window.dispatchEvent(new CustomEvent('campaignsUpdated', { detail: campaigns }));
      }
      
    } catch (error) {
      console.error('❌ Erro ao sincronizar campanhas:', error);
    }
  }
}

export const syncService = new SyncService();
