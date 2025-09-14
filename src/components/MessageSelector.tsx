import React, { useState } from 'react';
import { Message } from '../types';
import './MessageSelector.css';

interface MessageSelectorProps {
  messages: Message[];
  selectedMessages: string[];
  onSelectionChange: (messageIds: string[]) => void;
  onAddClick?: () => void;
}

const MessageSelector: React.FC<MessageSelectorProps> = ({
  messages,
  selectedMessages,
  onSelectionChange,
  onAddClick
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const handleMessageToggle = (messageId: string) => {
    const isSelected = selectedMessages.includes(messageId);
    let newSelection: string[];

    if (isSelected) {
      newSelection = selectedMessages.filter(id => id !== messageId);
    } else {
      newSelection = [...selectedMessages, messageId];
    }

    onSelectionChange(newSelection);
  };

  const getSelectedMessagesText = () => {
    if (selectedMessages.length === 0) {
      return 'Selecione as mensagens';
    }
    if (selectedMessages.length === 1) {
      const message = messages.find(m => m.id === selectedMessages[0]);
      return message?.nome || 'Mensagem selecionada';
    }
    return `${selectedMessages.length} mensagens selecionadas`;
  };

  const getMessageTypeIcon = (tipo: Message['tipo']) => {
    switch (tipo) {
      case 'texto': return '📝';
      case 'audio': return '🎵';
      case 'documento': return '📄';
      case 'video': return '🎥';
      case 'imagem': return '🖼️';
      default: return '📝';
    }
  };

  return (
    <div className="message-selector">
      <div className="message-selector-header">
        <label>Mensagens para envio</label>
        {onAddClick && (
          <button type="button" className="add-icon-btn" onClick={onAddClick} aria-label="Adicionar mensagem">+</button>
        )}
      </div>
      <div className="dropdown-container">
        <button
          type="button"
          className={`dropdown-trigger ${isOpen ? 'open' : ''}`}
          onClick={() => setIsOpen(!isOpen)}
        >
          <span>{getSelectedMessagesText()}</span>
          <span className={`arrow ${isOpen ? 'up' : 'down'}`}>▼</span>
        </button>

        {isOpen && (
          <div className="dropdown-menu">
            {messages.length === 0 ? (
              <div className="no-messages">
                Nenhuma mensagem criada ainda
              </div>
            ) : (
              messages
                .sort((a, b) => a.ordem - b.ordem)
                .map((message) => (
                  <div
                    key={message.id}
                    className={`message-item ${selectedMessages.includes(message.id) ? 'selected' : ''}`}
                    onClick={() => handleMessageToggle(message.id)}
                  >
                    <div className="message-info">
                      <span className="message-icon">
                        {getMessageTypeIcon(message.tipo)}
                      </span>
                      <div className="message-details">
                        <span className="message-name">{message.nome}</span>
                        <span className="message-type">{message.tipo}</span>
                      </div>
                      <span className="message-order">#{message.ordem}</span>
                    </div>
                    <div className="checkbox">
                      {selectedMessages.includes(message.id) && '✓'}
                    </div>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      {selectedMessages.length > 0 && (
        <div className="selected-summary">
          <h4>Sequência de Envio:</h4>
          <div className="selected-messages-list">
            {selectedMessages
              .map(id => messages.find(m => m.id === id))
              .filter(Boolean)
              .sort((a, b) => (a?.ordem || 0) - (b?.ordem || 0))
              .map((message, index) => (
                <div key={message?.id} className="selected-message-item">
                  <span className="sequence-number">{index + 1}.</span>
                  <span className="message-icon">
                    {getMessageTypeIcon(message?.tipo || 'texto')}
                  </span>
                  <span className="message-name">{message?.nome}</span>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
};

export default MessageSelector;
