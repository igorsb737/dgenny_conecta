import React, { useState, useEffect } from 'react';
import { Lead, Campaign } from '../types';
import { CrmService } from '../services/crmService';
import { offlineService } from '../services/offlineService';
import { syncService } from '../services/syncService';
import SequenceSelector from './SequenceSelector';
import './LeadForm.css';

interface LeadFormProps {
  onSubmit: (lead: Lead) => void;
  campaigns: Campaign[];
  selectedCampaignId: string | null;
  onCampaignChange: (campaignId: string | null) => void;
  onEditCampaign?: (campaign: Campaign) => void;
  onDeleteCampaign?: (campaign: Campaign) => void;
}

const LeadForm: React.FC<LeadFormProps> = ({ onSubmit, campaigns, selectedCampaignId, onCampaignChange, onEditCampaign, onDeleteCampaign }) => {
  const [formData, setFormData] = useState<Lead>({
    nome: '',
    empresa: '',
    telefone: ''
  });

  const [errors, setErrors] = useState<Partial<Lead>>({});
  const [sendingToCrm, setSendingToCrm] = useState<boolean>(false);
  const [crmStatus, setCrmStatus] = useState<{ type: 'success' | 'error' | '', message: string }>({ type: '', message: '' });
  const [isOfflineReady, setIsOfflineReady] = useState(false);

  useEffect(() => {
    // Inicializar serviços offline
    const initOffline = async () => {
      try {
        await offlineService.init();
        syncService.startSync();
        setIsOfflineReady(true);
        console.log('✅ Sistema offline inicializado');
      } catch (error) {
        console.error('❌ Erro ao inicializar sistema offline:', error);
      }
    };

    initOffline();

    return () => {
      syncService.stopSync();
    };
  }, []);

  const validateForm = (): boolean => {
    const newErrors: Partial<Lead> = {};

    if (!formData.nome.trim()) {
      newErrors.nome = 'Nome é obrigatório';
    }

    if (!formData.empresa.trim()) {
      newErrors.empresa = 'Empresa é obrigatória';
    }

    if (!formData.telefone.replace(/\D/g, '')) {
      newErrors.telefone = 'Telefone é obrigatório';
    } else if (formData.telefone.replace(/\D/g, '').length < 10) {
      newErrors.telefone = 'Telefone deve ter pelo menos 10 dígitos';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (validateForm()) {
      // Normalizar telefone com DDI 55
      const normalizePhone = (phone: string) => {
        const digits = phone.replace(/\D/g, '');
        if (digits.startsWith('55')) return digits;
        // Remove 0 inicial se houver
        const trimmed = digits.replace(/^0+/, '');
        return `55${trimmed}`;
      };

      const leadData = {
        ...formData,
        telefone: normalizePhone(formData.telefone)
      };
      
      // Sempre salvar offline primeiro (instantâneo)
      if (isOfflineReady) {
        try {
          const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId);
          
          await offlineService.saveLead({
            nome: leadData.nome,
            empresa: leadData.empresa,
            telefone: leadData.telefone,
            campaignId: selectedCampaignId || undefined,
            crmProvider: selectedCampaign?.crmProvider,
            crmStage: selectedCampaign?.crmStage
          });

          setCrmStatus({ 
            type: 'success', 
            message: '✅ Lead salvo! Será sincronizado automaticamente quando houver conexão.' 
          });

          // Enviar lead para o componente pai (para atualizar lista local)
          onSubmit(leadData);

          // Reset form
          setFormData({ nome: '', empresa: '', telefone: '' });
          setErrors({});

          // Limpar mensagem após 3 segundos
          setTimeout(() => {
            setCrmStatus({ type: '', message: '' });
          }, 3000);

        } catch (error) {
          console.error('❌ Erro ao salvar offline:', error);
          setCrmStatus({ 
            type: 'error', 
            message: 'Erro ao salvar lead. Tente novamente.' 
          });
        }
      } else {
        // Fallback: salvar apenas localmente se offline não estiver pronto
        onSubmit(leadData);
        setFormData({ nome: '', empresa: '', telefone: '' });
        setErrors({});
      }
    }
  };

  const handleCrmSubmission = async (lead: Lead, campaign: Campaign) => {
    if (!campaign.crmProvider || !campaign.crmStage) return;
    
    setSendingToCrm(true);
    setCrmStatus({ type: '', message: '' });
    
    try {
      const crmLead = {
        name: lead.nome,
        company: lead.empresa,
        phone: lead.telefone
      };
      
      await CrmService.sendLead(campaign.crmProvider, crmLead, campaign.crmStage);
      setCrmStatus({ 
        type: 'success', 
        message: `Lead enviado com sucesso para ${campaign.crmProvider}!` 
      });
      
      // Limpar mensagem de sucesso após 5 segundos
      setTimeout(() => {
        setCrmStatus({ type: '', message: '' });
      }, 5000);
      
    } catch (error) {
      console.error('Erro ao enviar lead para CRM:', error);
      setCrmStatus({ 
        type: 'error', 
        message: `Erro ao enviar para CRM: ${error instanceof Error ? error.message : 'Erro desconhecido'}` 
      });
      
      // Limpar mensagem de erro após 10 segundos
      setTimeout(() => {
        setCrmStatus({ type: '', message: '' });
      }, 10000);
    } finally {
      setSendingToCrm(false);
    }
  };

  // Máscara de telefone BR sem libs (evita findDOMNode)
  const formatPhoneBR = (value: string) => {
    const d = value.replace(/\D/g, '').slice(0, 11); // até 11 dígitos
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
  };

  const handlePhoneChange = (value: string) => {
    const masked = formatPhoneBR(value);
    setFormData(prev => ({ ...prev, telefone: masked }));
    if (errors.telefone) {
      setErrors(prev => ({ ...prev, telefone: undefined }));
    }
  };

  const handleInputChange = (field: keyof Lead, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <div className="lead-form-container">
      <form onSubmit={handleSubmit} className="lead-form">
        <div className="form-group">
          <label htmlFor="nome">Nome *</label>
          <input
            type="text"
            id="nome"
            value={formData.nome}
            onChange={(e) => handleInputChange('nome', e.target.value)}
            className={errors.nome ? 'error' : ''}
            placeholder="Digite o nome completo"
          />
          {errors.nome && <span className="error-message">{errors.nome}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="empresa">Empresa *</label>
          <input
            type="text"
            id="empresa"
            value={formData.empresa}
            onChange={(e) => handleInputChange('empresa', e.target.value)}
            className={errors.empresa ? 'error' : ''}
            placeholder="Digite o nome da empresa"
          />
          {errors.empresa && <span className="error-message">{errors.empresa}</span>}
        </div>

        <div className="form-group">
          <label htmlFor="telefone">Telefone *</label>
          <input
            id="telefone"
            type="tel"
            inputMode="numeric"
            maxLength={16}
            value={formData.telefone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            className={errors.telefone ? 'error' : ''}
            placeholder="(11) 99999-9999"
            aria-label="Telefone"
          />
          {errors.telefone && <span className="error-message">{errors.telefone}</span>}
        </div>

        {/* Seletor de sequência logo abaixo do telefone */}
        <div className="form-group">
          <SequenceSelector
            campaigns={campaigns}
            selectedCampaignId={selectedCampaignId}
            onChange={onCampaignChange}
            onEdit={onEditCampaign}
            onDelete={onDeleteCampaign}
          />
        </div>

        {/* Status do CRM */}
        {crmStatus.message && (
          <div className={`crm-status ${crmStatus.type}`}>
            {crmStatus.type === 'success' ? '✅' : '❌'} {crmStatus.message}
          </div>
        )}

        <button type="submit" className="submit-btn" disabled={!isOfflineReady}>
          {!isOfflineReady ? 'Inicializando...' : 'Salvar Lead'}
        </button>
      </form>
    </div>
  );
};

export default LeadForm;
