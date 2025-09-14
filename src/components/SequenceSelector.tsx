import React, { useState } from 'react';
import { Campaign } from '../types';
import './SequenceSelector.css';

interface SequenceSelectorProps {
  campaigns: Campaign[];
  selectedCampaignId?: string | null;
  onChange: (campaignId: string | null) => void;
  onEdit?: (campaign: Campaign) => void;
  onDelete?: (campaign: Campaign) => void;
}

const SequenceSelector: React.FC<SequenceSelectorProps> = ({ campaigns, selectedCampaignId, onChange, onEdit, onDelete }) => {
  const [isOpen, setIsOpen] = useState(false);

  const selected = campaigns.find(c => c.id === selectedCampaignId) || null;

  const currentText = selected ? selected.nome : 'Selecione a sequência';

  return (
    <div className="sequence-selector">
      <label>Mensagens para envio</label>
      <div className="dropdown-container">
        <button
          type="button"
          className={`dropdown-trigger ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
        >
          <span>{currentText}</span>
          <span className={`arrow ${isOpen ? 'up' : 'down'}`}>▼</span>
        </button>

        {isOpen && (
          <div className="dropdown-menu" role="listbox">
            {campaigns.length === 0 ? (
              <div className="no-items">Nenhuma sequência criada</div>
            ) : (
              campaigns.map(c => (
                <div
                  key={c.id}
                  role="option"
                  aria-selected={selectedCampaignId === c.id}
                  className={`dropdown-item ${selectedCampaignId === c.id ? 'selected' : ''}`}
                  onClick={() => { onChange(c.id); setIsOpen(false); }}
                >
                  <span className="item-name">{c.nome}</span>
                  <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
                    {onEdit && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Editar"
                        aria-label="Editar"
                        onClick={(e) => { e.stopPropagation(); onEdit(c); }}
                      >
                        ✎
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Excluir"
                        aria-label="Excluir"
                        onClick={(e) => { e.stopPropagation(); onDelete(c); }}
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
            {selectedCampaignId && (
              <div
                className="dropdown-item clear"
                onClick={() => { onChange(null); setIsOpen(false); }}
              >
                Limpar seleção
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SequenceSelector;
