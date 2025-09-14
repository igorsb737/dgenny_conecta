export interface CrmProvider {
  id: string;
  name: string;
  stages: CrmStage[];
}

export interface CrmStage {
  id: string;
  name: string;
  probability?: number;
}

export interface CrmLead {
  name: string;
  company: string;
  phone: string;
  stage?: string;
}

export interface CrmOpportunity {
  name: string;
  accountName: string;
  stage: string;
  amount?: number;
  description?: string;
  contactName?: string;
  contactPhone?: string;
}

// EspoCRM default stages
const ESPO_DEFAULT_STAGES: CrmStage[] = [
  { id: 'Prospecting', name: 'Prospecting', probability: 10 },
  { id: 'Qualification', name: 'Qualification', probability: 20 },
  { id: 'Proposal', name: 'Proposal', probability: 50 },
  { id: 'Negotiation', name: 'Negotiation', probability: 80 },
  { id: 'Closed Won', name: 'Closed Won', probability: 100 },
  { id: 'Closed Lost', name: 'Closed Lost', probability: 0 }
];

export const CRM_PROVIDERS: CrmProvider[] = [
  {
    id: 'espocrm',
    name: 'EspoCRM (evento construir.ai)',
    stages: ESPO_DEFAULT_STAGES
  }
];

class EspoCrmService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.REACT_APP_ESPO_URL || '';
    this.apiKey = process.env.REACT_APP_ESPO_API_KEY || '';
  }

  private async makeRequest(endpoint: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', data?: any): Promise<any> {
    if (!this.isConfigured()) {
      throw new Error('EspoCRM não está configurado. Verifique as variáveis de ambiente.');
    }

    // Usa o proxy simples em desenvolvimento
    const url = process.env.NODE_ENV === 'development' 
      ? `/api/v1${endpoint}`
      : `${this.baseUrl}/api/v1${endpoint}`;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Método de autenticação padrão do EspoCRM
    headers['X-Api-Key'] = this.apiKey!;

    console.log('🔍 Fazendo requisição:', { url, method, headers });
    
    // Log do comando curl equivalente para debug
    const curlCommand = `curl -X ${method} "${this.baseUrl}/api/v1${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: ${this.apiKey}" \\
  ${data ? `-d '${JSON.stringify(data)}'` : ''}`;
    console.log('📋 Comando curl equivalente:', curlCommand);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
      });

      console.log('📥 Resposta recebida:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Erro na resposta:', errorText);
        throw new Error(`Erro HTTP: ${response.status} - ${response.statusText}`);
      }

      const result = await response.json();
      console.log('✅ Lead criado com sucesso:', result);
      return result;
    } catch (error) {
      console.error('Erro na requisição para EspoCRM:', error);
      throw new Error('Erro de conexão com EspoCRM. Verifique se a URL está correta e se o CORS está configurado no servidor.');
    }
  }

  async createLead(lead: CrmLead): Promise<any> {
    // Tenta criar como Contact primeiro (pode ter permissões diferentes)
    const contactData = {
      firstName: lead.name.split(' ')[0],
      lastName: lead.name.split(' ').slice(1).join(' ') || lead.name,
      accountName: lead.company,
      phoneNumber: lead.phone,
      source: 'Web Site'
    };

    console.log('📝 Tentando criar como Contact:', contactData);
    
    try {
      const result = await this.makeRequest('/Contact', 'POST', contactData);
      console.log('✅ Contact criado com sucesso:', result);
      return result;
    } catch (contactError) {
      console.log('❌ Erro ao criar Contact, tentando Lead:', contactError);
      
      // Se Contact falhar, tenta Lead
      const leadData = {
        firstName: lead.name.split(' ')[0],
        lastName: lead.name.split(' ').slice(1).join(' ') || lead.name,
        accountName: lead.company,
        phoneNumber: lead.phone,
        status: 'New',
        source: 'Web Site'
      };

      console.log('📝 Tentando criar como Lead:', leadData);
      return this.makeRequest('/Lead', 'POST', leadData);
    }
  }

  async createOpportunity(opportunity: CrmOpportunity): Promise<any> {
    const opportunityData = {
      name: opportunity.name,
      accountName: opportunity.accountName,
      stage: opportunity.stage,
      amount: opportunity.amount || 0,
      description: opportunity.description || '',
      source: 'Web Site'
    };

    return this.makeRequest('/Opportunity', 'POST', opportunityData);
  }

  async getStages(): Promise<CrmStage[]> {
    // Durante desenvolvimento, usar sempre os stages padrão devido ao CORS
    if (process.env.NODE_ENV === 'development') {
      console.info('Modo desenvolvimento: usando stages padrão do EspoCRM');
      return ESPO_DEFAULT_STAGES;
    }

    try {
      // Em produção, tenta buscar os stages customizados do EspoCRM
      const metadata = await this.makeRequest('/Metadata', 'GET');
      const opportunityStages = metadata?.entityDefs?.Opportunity?.fields?.stage?.options;
      
      if (opportunityStages && Array.isArray(opportunityStages)) {
        return opportunityStages.map((stage: string) => ({
          id: stage,
          name: stage
        }));
      }
    } catch (error) {
      console.warn('Não foi possível buscar stages customizados, usando padrões:', error);
    }

    // Fallback para stages padrão
    return ESPO_DEFAULT_STAGES;
  }

  isConfigured(): boolean {
    return !!(this.baseUrl && this.apiKey);
  }
}

export const espoCrmService = new EspoCrmService();

export class CrmService {
  static async sendLead(providerId: string, lead: CrmLead, stage?: string): Promise<any> {
    switch (providerId) {
      case 'espocrm':
        console.log('🔄 Criando lead no EspoCRM:', lead);
        
        try {
          return await espoCrmService.createLead(lead);
        } catch (error) {
          console.log('❌ Erro no EspoCRM, salvando no Firestore como backup:', error);
          
          // Salva no Firestore como backup quando EspoCRM falha
          const { addDoc, collection, serverTimestamp } = await import('firebase/firestore');
          const { db } = await import('../firebase');
          
          const leadBackup = {
            ...lead,
            crmProvider: providerId,
            crmStage: stage || null,
            attemptedAt: serverTimestamp(),
            status: 'pending_crm_sync',
            error: error instanceof Error ? error.message : 'Erro desconhecido'
          };
          
          const docRef = await addDoc(collection(db, 'leads_backup'), leadBackup);
          console.log('✅ Lead salvo no Firestore como backup:', docRef.id);
          
          return {
            id: docRef.id,
            success: true,
            message: 'Lead salvo temporariamente. Será sincronizado com o CRM quando as permissões forem corrigidas.',
            backup: true
          };
        }
      default:
        throw new Error(`Provedor CRM não suportado: ${providerId}`);
    }
  }

  static async getStages(providerId: string): Promise<CrmStage[]> {
    switch (providerId) {
      case 'espocrm':
        return espoCrmService.getStages();
      default:
        throw new Error(`Provedor CRM não suportado: ${providerId}`);
    }
  }

  static isProviderConfigured(providerId: string): boolean {
    switch (providerId) {
      case 'espocrm':
        return espoCrmService.isConfigured();
      default:
        return false;
    }
  }
}
